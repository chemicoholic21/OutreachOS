import { NextResponse, after } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { tick } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parse CSV string into rows
function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      rows[rows.length - 1]?.push(current) ?? rows.push([current]);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (current || rows[rows.length - 1]?.length) {
        rows[rows.length - 1]?.push(current) ?? rows.push([current]);
        rows.push([]);
        current = "";
      }
      if (char === "\r" && next === "\n") i++; // skip \r\n
    } else {
      current += char;
    }
  }

  if (current || rows[rows.length - 1]?.length) {
    rows[rows.length - 1]?.push(current) ?? rows.push([current]);
  }

  return rows.filter((r) => r.some((cell) => cell.trim()));
}

type BulkResult = {
  total: number;
  success: number;
  errors: Array<{ row: number; error: string }>;
};

export async function POST(req: Request) {
  await ensureSchema();
  
  try {
    const body = await req.json();
    const { csvData } = body;

    if (!csvData || typeof csvData !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid csvData" },
        { status: 400 }
      );
    }

    const rows = parseCSV(csvData);
    if (rows.length < 2) {
      return NextResponse.json(
        { error: "CSV must have header row and at least one data row" },
        { status: 400 }
      );
    }

    const header = rows[0];
    const nameIdx = header.findIndex((h) =>
      h.toLowerCase().includes("name")
    );
    const textIdx = header.findIndex((h) =>
      h.toLowerCase().includes("text") || h.toLowerCase().includes("application")
    );

    if (nameIdx === -1 || textIdx === -1) {
      return NextResponse.json(
        {
          error:
            "CSV must have 'name' (or similar) and 'text'/'application' columns",
        },
        { status: 400 }
      );
    }

    const result: BulkResult = {
      total: rows.length - 1,
      success: 0,
      errors: [],
    };

    const appIds: string[] = [];

    // Insert applications and create screening tasks
    for (let i = 1; i < rows.length; i++) {
      try {
        const row = rows[i];
        const name = String(row[nameIdx] || "").trim();
        const text = String(row[textIdx] || "").trim();

        if (!name || !text) {
          result.errors.push({
            row: i + 1, // +1 for CSV line numbering (0-indexed header)
            error: "Missing name or text/application field",
          });
          continue;
        }

        const [app] = await sql<{ id: string }[]>`
          INSERT INTO applications (applicant_name, raw_text, status)
          VALUES (${name}, ${text}, 'PENDING') RETURNING id`;

        appIds.push(app.id);

        // Create screening task
        await sql`
          INSERT INTO tasks (title, description, status, assigned_to)
          VALUES (${`Screen: ${name}`}, ${app.id}, 'BACKLOG', 'agent_screening')`;

        result.success++;
      } catch (err) {
        result.errors.push({
          row: i + 1,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Kick the worker in the background
    after(async () => {
      try {
        await tick();
      } catch {
        /* cron + frontend poll are backstops */
      }
    });

    return NextResponse.json({
      ...result,
      applicationsCreated: appIds,
      message: `Created ${result.success}/${result.total} applications`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
