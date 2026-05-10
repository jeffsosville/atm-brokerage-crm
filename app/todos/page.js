"use client";

import { useState, useEffect } from "react";

const PRIORITY_COLORS = {
  high: "#dc2626",
  medium: "#d97706",
  low: "#65a30d",
};

const STATUS_COLORS = {
  open: "#6b7280",
  in_progress: "#2563eb",
  done: "#16a34a",
};

const ASSIGNEE_LABELS = {
  jeff: "Jeff",
  john: "John",
  both: "Both",
};

export default function TodosPage() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTodo, setNewTodo] = useState({
    title: "",
    notes: "",
    assigned_to: "both",
    priority: "medium",
    due_date: "",
  });

  useEffect(() => {
    loadTodos();
  }, []);

  async function loadTodos() {
    setLoading(true);
    try {
      const res = await fetch("/api/todos");
      const data = await res.json();
      setTodos(data.todos || []);
    } catch (err) {
      console.error("Failed to load todos:", err);
    }
    setLoading(false);
  }

  async function updateTodo(id, updates) {
    try {
      await fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      loadTodos();
    } catch (err) {
      console.error("Update failed:", err);
    }
  }

  async function deleteTodo(id) {
    if (!confirm("Delete this task?")) return;
    try {
      await fetch(`/api/todos/${id}`, { method: "DELETE" });
      loadTodos();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  async function createTodo() {
    if (!newTodo.title.trim()) return;
    try {
      await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newTodo,
          due_date: newTodo.due_date || null,
          created_by: "jeff",
        }),
      });
      setNewTodo({
        title: "",
        notes: "",
        assigned_to: "both",
        priority: "medium",
        due_date: "",
      });
      setShowNewForm(false);
      loadTodos();
    } catch (err) {
      console.error("Create failed:", err);
    }
  }

  const filtered = todos.filter((t) => {
    if (filter !== "all" && t.status !== filter) return false;
    if (assigneeFilter !== "all" && t.assigned_to !== assigneeFilter) return false;
    return true;
  });

  // Sort: priority (high → low) then due_date (soonest first, nulls last)
  const sorted = [...filtered].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  const counts = {
    open: todos.filter((t) => t.status === "open").length,
    in_progress: todos.filter((t) => t.status === "in_progress").length,
    done: todos.filter((t) => t.status === "done").length,
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Sosville Ops</h1>
          <div style={{ fontSize: 14, color: "#6b7280", marginTop: 4 }}>
            Shared task list — Jeff & John
          </div>
        </div>
        <button
          onClick={() => setShowNewForm(!showNewForm)}
          style={{
            background: "#111827",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showNewForm ? "Cancel" : "+ New Task"}
        </button>
      </div>

      {showNewForm && (
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <input
            type="text"
            placeholder="Task title"
            value={newTodo.title}
            onChange={(e) => setNewTodo({ ...newTodo, title: e.target.value })}
            style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #d1d5db", fontSize: 15, marginBottom: 8 }}
          />
          <textarea
            placeholder="Notes / context (optional)"
            value={newTodo.notes}
            onChange={(e) => setNewTodo({ ...newTodo, notes: e.target.value })}
            rows={3}
            style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, marginBottom: 8, resize: "vertical", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <select value={newTodo.assigned_to} onChange={(e) => setNewTodo({ ...newTodo, assigned_to: e.target.value })} style={selectStyle}>
              <option value="both">Both</option>
              <option value="jeff">Jeff</option>
              <option value="john">John</option>
            </select>
            <select value={newTodo.priority} onChange={(e) => setNewTodo({ ...newTodo, priority: e.target.value })} style={selectStyle}>
              <option value="high">High priority</option>
              <option value="medium">Medium priority</option>
              <option value="low">Low priority</option>
            </select>
            <input
              type="date"
              value={newTodo.due_date}
              onChange={(e) => setNewTodo({ ...newTodo, due_date: e.target.value })}
              style={selectStyle}
            />
          </div>
          <button
            onClick={createTodo}
            style={{ background: "#16a34a", color: "white", border: "none", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}
          >
            Add Task
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <FilterChip label={`Open (${counts.open})`} active={filter === "open"} onClick={() => setFilter("open")} />
        <FilterChip label={`In Progress (${counts.in_progress})`} active={filter === "in_progress"} onClick={() => setFilter("in_progress")} />
        <FilterChip label={`Done (${counts.done})`} active={filter === "done"} onClick={() => setFilter("done")} />
        <FilterChip label="All" active={filter === "all"} onClick={() => setFilter("all")} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <FilterChip label="Everyone" active={assigneeFilter === "all"} onClick={() => setAssigneeFilter("all")} small />
        <FilterChip label="Jeff" active={assigneeFilter === "jeff"} onClick={() => setAssigneeFilter("jeff")} small />
        <FilterChip label="John" active={assigneeFilter === "john"} onClick={() => setAssigneeFilter("john")} small />
        <FilterChip label="Both" active={assigneeFilter === "both"} onClick={() => setAssigneeFilter("both")} small />
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>No tasks match the current filter.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((todo) => (
            <div
              key={todo.id}
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 12,
                opacity: todo.status === "done" ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <input
                  type="checkbox"
                  checked={todo.status === "done"}
                  onChange={(e) => updateTodo(todo.id, { status: e.target.checked ? "done" : "open" })}
                  style={{ marginTop: 4, width: 18, height: 18, cursor: "pointer" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    onClick={() => setExpanded(expanded === todo.id ? null : todo.id)}
                    style={{
                      cursor: "pointer",
                      fontSize: 15,
                      fontWeight: 600,
                      textDecoration: todo.status === "done" ? "line-through" : "none",
                      color: "#111827",
                    }}
                  >
                    {todo.title}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", fontSize: 12 }}>
                    <span style={{ ...badgeStyle, background: PRIORITY_COLORS[todo.priority] }}>
                      {todo.priority}
                    </span>
                    <span style={{ ...badgeStyle, background: "#475569" }}>
                      {ASSIGNEE_LABELS[todo.assigned_to]}
                    </span>
                    <span style={{ ...badgeStyle, background: STATUS_COLORS[todo.status] }}>
                      {todo.status.replace("_", " ")}
                    </span>
                    {todo.due_date && (
                      <span style={{ ...badgeStyle, background: "#0891b2" }}>
                        Due {todo.due_date}
                      </span>
                    )}
                  </div>
                  {expanded === todo.id && (
                    <div style={{ marginTop: 12, padding: 12, background: "#f9fafb", borderRadius: 6, fontSize: 14, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                      {todo.notes || <em style={{ color: "#9ca3af" }}>No notes</em>}
                      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <select
                          value={todo.status}
                          onChange={(e) => updateTodo(todo.id, { status: e.target.value })}
                          style={smallSelectStyle}
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="done">Done</option>
                        </select>
                        <select
                          value={todo.assigned_to}
                          onChange={(e) => updateTodo(todo.id, { assigned_to: e.target.value })}
                          style={smallSelectStyle}
                        >
                          <option value="jeff">Jeff</option>
                          <option value="john">John</option>
                          <option value="both">Both</option>
                        </select>
                        <select
                          value={todo.priority}
                          onChange={(e) => updateTodo(todo.id, { priority: e.target.value })}
                          style={smallSelectStyle}
                        >
                          <option value="high">High</option>
                          <option value="medium">Medium</option>
                          <option value="low">Low</option>
                        </select>
                        <button
                          onClick={() => deleteTodo(todo.id)}
                          style={{ background: "transparent", color: "#dc2626", border: "1px solid #fca5a5", padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", marginLeft: "auto" }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick, small }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "#111827" : "white",
        color: active ? "white" : "#374151",
        border: "1px solid " + (active ? "#111827" : "#d1d5db"),
        padding: small ? "4px 12px" : "6px 14px",
        borderRadius: 999,
        fontSize: small ? 12 : 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

const selectStyle = {
  padding: 8,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "white",
};

const smallSelectStyle = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 12,
  background: "white",
};

const badgeStyle = {
  color: "white",
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.3,
};
