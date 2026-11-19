import { query } from "@/lib/db";
import type { QueryResultRow } from "pg";

type TaskRow = QueryResultRow & {
  id: string;
  session_id: string;
  title: string;
  task_date: string;
  scheduled_time: string | null;
  is_completed: boolean;
  reminder_enabled: boolean;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
};

const taskColumns = `
  id, session_id, title, task_date,
  to_char(scheduled_time, 'HH24:MI') AS scheduled_time,
  is_completed, reminder_enabled, notified_at, created_at, updated_at
`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && timePattern.test(value);
}

async function readBody(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function serverError(error: unknown) {
  console.error("Task API database error:", error);
  return Response.json({ error: "The task service is temporarily unavailable." }, { status: 500 });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("session_id");
  const taskDate = params.get("date");

  if (!isUuid(sessionId) || !isDate(taskDate)) {
    return Response.json({ error: "A valid session_id UUID and date (YYYY-MM-DD) are required." }, { status: 400 });
  }

  try {
    const result = await query<TaskRow>(
      `SELECT ${taskColumns} FROM tasks WHERE session_id = $1 AND task_date = $2::date ORDER BY scheduled_time NULLS LAST, created_at`,
      [sessionId, taskDate],
    );
    return Response.json({ tasks: result.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });

  const sessionId = body.session_id;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const taskDate = body.task_date;
  const scheduledTime = body.scheduled_time ?? null;

  if (!isUuid(sessionId)) {
    return Response.json({ error: "A valid session_id UUID is required." }, { status: 400 });
  }
  if (!title || title.length > 255) {
    return Response.json({ error: "Title must contain between 1 and 255 characters." }, { status: 400 });
  }
  if (!isDate(taskDate)) {
    return Response.json({ error: "A valid task_date (YYYY-MM-DD) is required." }, { status: 400 });
  }
  if (scheduledTime !== null && !isTime(scheduledTime)) {
    return Response.json({ error: "scheduled_time must use HH:MM or be null." }, { status: 400 });
  }

  try {
    const result = await query<TaskRow>(
      `INSERT INTO tasks (session_id, title, task_date, scheduled_time)
       VALUES ($1, $2, $3::date, $4::time)
       RETURNING ${taskColumns}`,
      [sessionId, title, taskDate, scheduledTime],
    );
    return Response.json({ task: result.rows[0] }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });

  const { id, session_id: sessionId } = body;
  if (!isUuid(id) || !isUuid(sessionId)) {
    return Response.json({ error: "A valid task id and session_id UUID are required." }, { status: 400 });
  }

  try {
    if (body.claim_reminder === true) {
      const result = await query<TaskRow>(
        `UPDATE tasks SET notified_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND session_id = $2 AND notified_at IS NULL
           AND is_completed = FALSE AND reminder_enabled = TRUE
         RETURNING ${taskColumns}`,
        [id, sessionId],
      );
      return Response.json({ task: result.rows[0] ?? null });
    }

    const fields: Array<{ column: string; value: string | boolean | null }> = [];
    if (Object.hasOwn(body, "title")) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > 255) {
        return Response.json({ error: "Title must contain between 1 and 255 characters." }, { status: 400 });
      }
      fields.push({ column: "title", value: title });
    }
    if (Object.hasOwn(body, "scheduled_time")) {
      if (body.scheduled_time !== null && !isTime(body.scheduled_time)) {
        return Response.json({ error: "scheduled_time must use HH:MM or be null." }, { status: 400 });
      }
      fields.push({ column: "scheduled_time", value: body.scheduled_time });
    }
    if (Object.hasOwn(body, "is_completed")) {
      if (typeof body.is_completed !== "boolean") {
        return Response.json({ error: "is_completed must be a boolean." }, { status: 400 });
      }
      fields.push({ column: "is_completed", value: body.is_completed });
    }
    if (Object.hasOwn(body, "reminder_enabled")) {
      if (typeof body.reminder_enabled !== "boolean") {
        return Response.json({ error: "reminder_enabled must be a boolean." }, { status: 400 });
      }
      fields.push({ column: "reminder_enabled", value: body.reminder_enabled });
    }
    if (fields.length === 0) {
      return Response.json({ error: "Provide at least one task field to update." }, { status: 400 });
    }

    const assignments = fields.map(({ column }, index) => `${column} = $${index + 3}`);
    assignments.push("updated_at = NOW()");
    const values = fields.map(({ value }) => value);
    const result = await query<TaskRow>(
      `UPDATE tasks SET ${assignments.join(", ")}
       WHERE id = $1 AND session_id = $2
       RETURNING ${taskColumns}`,
      [id, sessionId, ...values],
    );
    if (!result.rows[0]) return Response.json({ error: "Task not found." }, { status: 404 });
    return Response.json({ task: result.rows[0] });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request) {
  const body = await readBody(request);
  if (!body) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });

  const { id, session_id: sessionId } = body;
  if (!isUuid(id) || !isUuid(sessionId)) {
    return Response.json({ error: "A valid task id and session_id UUID are required." }, { status: 400 });
  }

  try {
    const result = await query(
      "DELETE FROM tasks WHERE id = $1 AND session_id = $2 RETURNING id",
      [id, sessionId],
    );
    if (result.rowCount === 0) return Response.json({ error: "Task not found." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    return serverError(error);
  }
}
