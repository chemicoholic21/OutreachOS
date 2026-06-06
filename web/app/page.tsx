"use client";

import { useState, useEffect, useCallback } from "react";

type Application = {
  id: string;
  applicant_name: string;
  raw_text: string;
  status: string;
  score: number | null;
  agent_reasoning: string | null;
  human_note: string | null;
  created_at: string | null;
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string;
  block_reason: string | null;
  block_question: string | null;
  output: string | null;
  created_at: string | null;
};

type Log = {
  id: string;
  agent_name: string | null;
  action: string;
  detail: string | null;
  created_at: string | null;
};

type Memory = {
  id: string;
  agent_name: string;
  memory_key: string;
  memory_value: string;
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  MAYBE: "bg-yellow-100 text-yellow-700",
  WAITING_APPROVAL: "bg-yellow-100 text-yellow-700",
  BACKLOG: "bg-gray-100 text-gray-500",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  BLOCKED: "bg-red-100 text-red-700",
  COMPLETED: "bg-green-100 text-green-700",
};

const AGENT_COLOR: Record<string, string> = {
  agent_screening: "bg-purple-100 text-purple-700",
  agent_outreach: "bg-blue-100 text-blue-700",
  agent_channel: "bg-orange-100 text-orange-700",
  human: "bg-gray-100 text-gray-700",
};

export default function Home() {
  const [tab, setTab] = useState("applications");
  const [applications, setApps] = useState<Application[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [memory, setMemory] = useState<Memory[]>([]);
  const [selected, setSelected] = useState<Application | Task | null>(null);
  const [selectedType, setType] = useState<"app" | "task" | null>(null);
  const [humanNote, setHumanNote] = useState("");
  const [newApp, setNewApp] = useState({ name: "", text: "" });
  const [newTask, setNewTask] = useState({
    title: "",
    assigned_to: "agent_outreach",
  });
  const [submitting, setSubmitting] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<{
    success: number;
    total: number;
    errors: Array<{ row: number; error: string }>;
    message: string;
  } | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      // Ping the worker (idempotent) so progress happens on any Vercel plan.
      fetch("/api/cron/tick").catch(() => {});
      const [a, t, l, m] = await Promise.all([
        fetch("/api/applications").then((r) => r.json()),
        fetch("/api/tasks").then((r) => r.json()),
        fetch("/api/logs").then((r) => r.json()),
        fetch("/api/memory").then((r) => r.json()),
      ]);
      setApps(a);
      setTasks(t);
      setLogs(l);
      setMemory(m);
    } catch {
      /* keep polling */
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 3000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  // Keep the open modal in sync with freshly polled data.
  useEffect(() => {
    if (!selected) return;
    const list: (Application | Task)[] =
      selectedType === "app" ? applications : tasks;
    const fresh = list.find((x) => x.id === selected.id);
    if (fresh) setSelected(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applications, tasks]);

  const submitApp = async () => {
    if (!newApp.name || !newApp.text) return;
    setSubmitting(true);
    await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applicant_name: newApp.name,
        raw_text: newApp.text,
      }),
    });
    setNewApp({ name: "", text: "" });
    setSubmitting(false);
    fetchAll();
  };

  const submitCSV = async () => {
    if (!csvFile) return;
    setCsvUploading(true);
    setCsvResult(null);
    try {
      const csvData = await csvFile.text();
      const response = await fetch("/api/applications/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData }),
      });
      const result = await response.json();
      if (response.ok) {
        setCsvResult(result);
        setCsvFile(null);
        setTimeout(() => {
          setCsvResult(null);
          fetchAll();
        }, 3000);
      } else {
        setCsvResult({
          success: 0,
          total: 0,
          errors: [{ row: 0, error: result.error || "Upload failed" }],
          message: "Error",
        });
      }
    } catch (err) {
      setCsvResult({
        success: 0,
        total: 0,
        errors: [
          {
            row: 0,
            error: err instanceof Error ? err.message : "Upload failed",
          },
        ],
        message: "Error",
      });
    }
    setCsvUploading(false);
  };

  const submitTask = async () => {
    if (!newTask.title) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTask),
    });
    setNewTask({ title: "", assigned_to: "agent_outreach" });
    fetchAll();
  };

  const decideApp = async (decision: string) => {
    if (!selected) return;
    await fetch(`/api/applications/${selected.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: humanNote }),
    });
    setSelected(null);
    setHumanNote("");
    fetchAll();
  };

  const respondTask = async (action: string) => {
    if (!selected) return;
    await fetch(`/api/tasks/${selected.id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: humanNote, action }),
    });
    setSelected(null);
    setHumanNote("");
    fetchAll();
  };

  const stats = {
    total: applications.length,
    approved: applications.filter((a) => a.status === "APPROVED").length,
    rejected: applications.filter((a) => a.status === "REJECTED").length,
    maybe: applications.filter(
      (a) => a.status === "WAITING_APPROVAL" || a.status === "MAYBE",
    ).length,
    pending: applications.filter((a) => a.status === "PENDING").length,
  };

  const asApp = selected as Application;
  const asTask = selected as Task;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">AgentOS</h1>
          <p className="text-xs text-gray-400">
            Candidate Screening &amp; Outreach — Coordination Layer
          </p>
        </div>
        <div className="flex gap-2">
          {["applications", "tasks", "timeline", "memory"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Applications Tab */}
      {tab === "applications" && (
        <div className="p-6">
          <div className="grid grid-cols-5 gap-3 mb-6">
            {[
              { label: "Total", value: stats.total, color: "bg-white" },
              { label: "Pending", value: stats.pending, color: "bg-gray-50" },
              {
                label: "Approved",
                value: stats.approved,
                color: "bg-green-50",
              },
              { label: "Rejected", value: stats.rejected, color: "bg-red-50" },
              { label: "Review", value: stats.maybe, color: "bg-yellow-50" },
            ].map((s) => (
              <div
                key={s.label}
                className={`${s.color} border rounded-lg p-4 text-center`}
              >
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-gray-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-white border rounded-lg p-4 mb-6">
            <p className="text-sm font-medium text-gray-700 mb-3">
              Submit Candidate Application for Screening
            </p>
            <div className="flex gap-3 mb-3">
              <input
                className="border rounded px-3 py-2 text-sm w-48"
                placeholder="Candidate name"
                value={newApp.name}
                onChange={(e) =>
                  setNewApp((p) => ({ ...p, name: e.target.value }))
                }
              />
            </div>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm mb-3"
              rows={4}
              placeholder="Paste application text — motivation, background, what they've built..."
              value={newApp.text}
              onChange={(e) =>
                setNewApp((p) => ({ ...p, text: e.target.value }))
              }
            />
            <button
              onClick={submitApp}
              disabled={submitting}
              className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit for Agent Screening"}
            </button>
          </div>

          {/* CSV Bulk Upload */}
          <div className="bg-white border rounded-lg p-4 mb-6">
            <p className="text-sm font-medium text-gray-700 mb-3">
              Bulk Upload from CSV
            </p>
            <p className="text-xs text-gray-500 mb-3">
              CSV must have &quot;name&quot; and &quot;text&quot; (or
              &quot;application&quot;) columns. All rows will be submitted for
              screening.
            </p>
            <div className="flex gap-3 items-center mb-3">
              <input
                type="file"
                accept=".csv"
                onChange={(e) => {
                  setCsvFile(e.target.files?.[0] || null);
                  setCsvResult(null);
                }}
                className="text-sm"
                disabled={csvUploading}
              />
              <button
                onClick={submitCSV}
                disabled={!csvFile || csvUploading}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              >
                {csvUploading ? "Uploading..." : "Upload CSV"}
              </button>
            </div>
            {csvFile && (
              <p className="text-xs text-gray-600">
                Selected: {csvFile.name}
              </p>
            )}
            {csvResult && (
              <div
                className={`mt-3 p-3 rounded text-sm ${
                  csvResult.errors.length === 0
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-yellow-50 text-yellow-700 border border-yellow-200"
                }`}
              >
                <p className="font-medium">{csvResult.message}</p>
                <p className="text-xs mt-1">
                  {csvResult.success}/{csvResult.total} rows imported
                </p>
                {csvResult.errors.length > 0 && (
                  <div className="mt-2 text-xs">
                    <p className="font-medium">Errors:</p>
                    {csvResult.errors.slice(0, 5).map((err, i) => (
                      <p key={i}>
                        Row {err.row}: {err.error}
                      </p>
                    ))}
                    {csvResult.errors.length > 5 && (
                      <p>...and {csvResult.errors.length - 5} more</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {applications.map((app) => (
              <div
                key={app.id}
                onClick={() => {
                  setSelected(app);
                  setType("app");
                }}
                className="bg-white border rounded-lg p-4 cursor-pointer hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-sm">
                      {app.applicant_name}
                    </span>
                    {app.score != null && (
                      <span className="text-xs text-gray-400">
                        Score: {app.score}/10
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLOR[app.status]}`}
                  >
                    {app.status}
                  </span>
                </div>
                {app.agent_reasoning && (
                  <p className="text-xs text-gray-500 mt-2">
                    {app.agent_reasoning}
                  </p>
                )}
              </div>
            ))}
            {applications.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                No applications yet. Submit one above to watch the agent screen
                it.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Tasks Tab */}
      {tab === "tasks" && (
        <div className="p-6">
          <div className="bg-white border rounded-lg p-4 mb-6 flex gap-3">
            <input
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder="Task title (e.g. Generate outreach messages for recruiter connectors)"
              value={newTask.title}
              onChange={(e) =>
                setNewTask((p) => ({ ...p, title: e.target.value }))
              }
              onKeyDown={(e) => e.key === "Enter" && submitTask()}
            />
            <select
              className="border rounded px-3 py-2 text-sm"
              value={newTask.assigned_to}
              onChange={(e) =>
                setNewTask((p) => ({ ...p, assigned_to: e.target.value }))
              }
            >
              <option value="agent_outreach">Outreach Agent</option>
              <option value="agent_channel">Channel Agent</option>
            </select>
            <button
              onClick={submitTask}
              className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium"
            >
              Create Task
            </button>
          </div>

          <div className="flex gap-4 overflow-x-auto">
            {[
              "BACKLOG",
              "IN_PROGRESS",
              "BLOCKED",
              "WAITING_APPROVAL",
              "COMPLETED",
            ].map((col) => (
              <div key={col} className="min-w-60 w-60">
                <div className="bg-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      {col.replace("_", " ")}
                    </h3>
                    <span className="text-xs bg-white rounded-full px-2 py-0.5 text-gray-500">
                      {tasks.filter((t) => t.status === col).length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {tasks
                      .filter((t) => t.status === col)
                      .map((task) => (
                        <div
                          key={task.id}
                          onClick={() => {
                            setSelected(task);
                            setType("task");
                          }}
                          className="bg-white rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                        >
                          <p className="text-sm font-medium text-gray-800 mb-2">
                            {task.title}
                          </p>
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-medium ${AGENT_COLOR[task.assigned_to] || "bg-gray-100"}`}
                          >
                            {task.assigned_to}
                          </span>
                          {task.status === "BLOCKED" && (
                            <p className="text-xs text-red-500 mt-1 truncate">
                              🔴 {task.block_question}
                            </p>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline Tab */}
      {tab === "timeline" && (
        <div className="p-6 max-w-2xl">
          <h2 className="font-semibold text-gray-700 mb-4">Activity Timeline</h2>
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="flex gap-3 items-start">
                <div className="text-xs text-gray-400 w-14 pt-0.5 shrink-0">
                  {log.created_at
                    ? new Date(log.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ""}
                </div>
                <div className="w-2 h-2 rounded-full bg-gray-300 mt-1.5 shrink-0" />
                <div>
                  <span className="text-sm font-medium text-gray-700">
                    {log.agent_name}
                  </span>
                  <span className="text-xs text-gray-400 ml-2 bg-gray-100 px-1.5 py-0.5 rounded">
                    {log.action}
                  </span>
                  {log.detail && (
                    <p className="text-xs text-gray-500 mt-0.5">{log.detail}</p>
                  )}
                </div>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-sm text-gray-400">No activity yet.</p>
            )}
          </div>
        </div>
      )}

      {/* Memory Tab */}
      {tab === "memory" && (
        <div className="p-6 max-w-2xl">
          <h2 className="font-semibold text-gray-700 mb-2">Agent Memory</h2>
          <p className="text-xs text-gray-400 mb-4">
            Agents save context here. Second runs use this automatically.
          </p>
          {memory.length === 0 ? (
            <p className="text-sm text-gray-400">
              No memories yet. Run some agents first.
            </p>
          ) : (
            <div className="space-y-2">
              {memory.map((m) => (
                <div
                  key={m.id}
                  className="bg-white border rounded p-3 flex gap-4 items-start"
                >
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${AGENT_COLOR[m.agent_name] || "bg-gray-100"}`}
                  >
                    {m.agent_name}
                  </span>
                  <span className="text-xs text-gray-400 w-40 shrink-0">
                    {m.memory_key}
                  </span>
                  <span className="text-sm text-gray-800">
                    {m.memory_value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-bold text-gray-900">
                  {selectedType === "app"
                    ? asApp.applicant_name
                    : asTask.title}
                </h2>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLOR[selected.status]}`}
                >
                  {selected.status}
                </span>
              </div>
              <button
                onClick={() => {
                  setSelected(null);
                  setHumanNote("");
                }}
                className="text-gray-400 hover:text-gray-600 text-xl ml-4"
              >
                ×
              </button>
            </div>

            {selectedType === "app" && (
              <>
                {asApp.score != null && (
                  <div className="bg-gray-50 rounded p-3 mb-3">
                    <p className="text-xs text-gray-500 font-medium">
                      Agent Score: {asApp.score}/10
                    </p>
                    <p className="text-sm text-gray-700 mt-1">
                      {asApp.agent_reasoning}
                    </p>
                  </div>
                )}
                <div className="bg-gray-50 rounded p-3 mb-4">
                  <p className="text-xs text-gray-500 font-medium mb-1">
                    Application Text
                  </p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {asApp.raw_text}
                  </p>
                </div>
                {selected.status === "WAITING_APPROVAL" && (
                  <div className="space-y-3">
                    <textarea
                      className="w-full border rounded p-3 text-sm"
                      rows={2}
                      placeholder="Optional note..."
                      value={humanNote}
                      onChange={(e) => setHumanNote(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => decideApp("APPROVED")}
                        className="flex-1 bg-green-600 text-white py-2 rounded text-sm font-medium"
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => decideApp("REJECTED")}
                        className="flex-1 bg-red-600 text-white py-2 rounded text-sm font-medium"
                      >
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {selectedType === "task" && (
              <>
                {asTask.output && (
                  <div className="bg-gray-50 rounded p-3 mb-3">
                    <p className="text-xs text-gray-500 font-medium mb-1">
                      Agent Output
                    </p>
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                      {asTask.output}
                    </pre>
                  </div>
                )}
                {asTask.block_reason && (
                  <div className="bg-red-50 border border-red-100 rounded p-3 mb-3">
                    <p className="text-xs text-red-500 font-medium">Blocked</p>
                    <p className="text-sm text-red-700 mt-1">
                      {asTask.block_reason}
                    </p>
                  </div>
                )}
                {asTask.block_question && (
                  <div className="bg-yellow-50 border border-yellow-100 rounded p-3 mb-3">
                    <p className="text-xs text-yellow-600 font-medium">
                      Agent needs your input
                    </p>
                    <p className="text-sm text-yellow-800 mt-1">
                      {asTask.block_question}
                    </p>
                  </div>
                )}
                {(selected.status === "WAITING_APPROVAL" ||
                  selected.status === "BLOCKED") && (
                  <div className="space-y-3">
                    <textarea
                      className="w-full border rounded p-3 text-sm"
                      rows={3}
                      placeholder={
                        selected.status === "BLOCKED"
                          ? "Your response to unblock the agent..."
                          : "Optional notes..."
                      }
                      value={humanNote}
                      onChange={(e) => setHumanNote(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => respondTask("approve")}
                        className="flex-1 bg-green-600 text-white py-2 rounded text-sm font-medium"
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => respondTask("respond")}
                        className="flex-1 bg-blue-600 text-white py-2 rounded text-sm font-medium"
                      >
                        ↩ Respond
                      </button>
                      <button
                        onClick={() => respondTask("reject")}
                        className="flex-1 bg-red-600 text-white py-2 rounded text-sm font-medium"
                      >
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
