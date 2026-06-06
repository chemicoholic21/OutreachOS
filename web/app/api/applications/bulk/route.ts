import { NextResponse, after } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { tick } from "@/lib/agents";
import { parseApplicationsCsv } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ROWS = 1000;

/**
 * Bulk-create applications from CSV. Body: { csv: string } (raw CSV text).
 * Each valid row becomes a PENDING application + a screening task; the worker
 * then drains them. Returns counts and any per-row errors.
 */
export async function POST(req: Request) {
  await ensureSchema();

  let csvText = "";
  try {
    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      const body = await req.json();
      csvText = String(body.csv ?? "");
    } else {
      csvText = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "Could not read body" }, { status: 400 });
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: "Empty CSV" }, { status: 400 });
  }

  const { rows, errors, total } = parseApplicationsCsv(csvText, MAX_ROWS);

  if (rows.length === 0) {
    return NextResponse.json(
      { created: 0, skipped: total, errors },
      { status: 400 },
    );
  }

  // Bulk insert applications, then a screening task per inserted application.
  const appValues = rows.map((r) => ({
    applicant_name: r.applicant_name,
    raw_text: r.raw_text,
    status: "PENDING",
  }));

  const inserted = (await sql`
    INSERT INTO applications ${sql(appValues, "applicant_name", "raw_text", "status")}
    RETURNING id, applicant_name`) as unknown as {
    id: string;
    applicant_name: string;
  }[];

  const taskValues = inserted.map((a) => ({
    title: `Screen: ${a.applicant_name}`,
    description: a.id,
    status: "BACKLOG",
    assigned_to: "agent_screening",
  }));
  await sql`
    INSERT INTO tasks ${sql(taskValues, "title", "description", "status", "assigned_to")}`;

  // Drain in the background; cron + frontend poll are backstops for big batches.
  after(async () => {
    try {
      await tick();
    } catch {
      /* backstops handle the rest */
    }
  });

  return NextResponse.json({
    created: inserted.length,
    skipped: total - inserted.length,
    errors,
  });
}
