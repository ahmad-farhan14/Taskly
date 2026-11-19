"use client";

import {
  AlarmClock,
  Bell,
  BellOff,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

type Task = {
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

type ApiResponse = { task?: Task | null; tasks?: Task[]; error?: string; deleted?: boolean };

const sessionStorageKey = "taskly.session-id";

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function apiRequest(url: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json() as ApiResponse;
  if (!response.ok) throw new Error(data.error ?? "Permintaan gagal. Coba lagi.");
  return data;
}

function formatTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function TasklyDashboard() {
  const [sessionId, setSessionId] = useState("");
  const [today, setToday] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [quickTitle, setQuickTitle] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTime, setDraftTime] = useState("09:00");
  const [editingQuickTask, setEditingQuickTask] = useState<Task | null>(null);
  const [bannerTask, setBannerTask] = useState<Task | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const timelineRows = useRef<Array<HTMLDivElement | null>>([]);
  const lastAutoScrollDate = useRef("");
  const reminderClaims = useRef(new Set<string>());
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      try {
        let id = localStorage.getItem(sessionStorageKey);
        if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          id = crypto.randomUUID();
          localStorage.setItem(sessionStorageKey, id);
        }
        if (active) setSessionId(id);
      } catch {
        if (active) setErrorMessage("Penyimpanan browser tidak tersedia. Aktifkan localStorage untuk memakai Taskly.");
      }
      if ("Notification" in window) setPermission(Notification.permission);
      else setPermission("unsupported");
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const current = new Date();
      setNow(current);
      setToday(localDateKey(current));
    };
    updateClock();
    const timer = setInterval(updateClock, 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sessionId || !today) return;
    let active = true;
    apiRequest(`/api/tasks?session_id=${encodeURIComponent(sessionId)}&date=${encodeURIComponent(today)}`)
      .then((response) => {
        if (active) setTasks(response.tasks ?? []);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : "Jadwal gagal dimuat.");
      });
    return () => {
      active = false;
    };
  }, [sessionId, today]);

  useEffect(() => {
    if (!now || !today || lastAutoScrollDate.current === today) return;
    const timer = setTimeout(() => {
      timelineRows.current[now.getHours()]?.scrollIntoView({ behavior: "smooth", block: "center" });
      lastAutoScrollDate.current = today;
    }, 350);
    return () => clearTimeout(timer);
  }, [now, today]);

  useEffect(() => {
    if (!now || !sessionId) return;
    const time = formatTime(now);
    const dueTasks = tasks.filter((task) =>
      task.scheduled_time === time &&
      task.reminder_enabled &&
      !task.is_completed &&
      !task.notified_at &&
      !reminderClaims.current.has(task.id),
    );

    for (const task of dueTasks) {
      reminderClaims.current.add(task.id);
      apiRequest("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, session_id: sessionId, claim_reminder: true }),
      }).then((response) => {
        if (!response.task) return;
        setBannerTask(task);
        if (bannerTimer.current) clearTimeout(bannerTimer.current);
        bannerTimer.current = setTimeout(() => setBannerTask(null), 10_000);
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("Taskly · waktunya mulai", { body: task.title, icon: "/favicon.ico" });
          } catch (error) {
            console.warn("Task reminder notification could not be displayed:", error);
          }
        }
        try {
          const AudioContextConstructor = window.AudioContext;
          if (AudioContextConstructor) {
            const context = new AudioContextConstructor();
            const start = context.currentTime;
            [660, 880].forEach((frequency, index) => {
              const oscillator = context.createOscillator();
              const gain = context.createGain();
              const at = start + index * 0.16;
              oscillator.type = "sine";
              oscillator.frequency.value = frequency;
              gain.gain.setValueAtTime(0.0001, at);
              gain.gain.exponentialRampToValueAtTime(0.08, at + 0.025);
              gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
              oscillator.connect(gain);
              gain.connect(context.destination);
              oscillator.start(at);
              oscillator.stop(at + 0.46);
            });
            setTimeout(() => void context.close(), 900);
          }
        } catch (error) {
          console.warn("Task reminder chime could not be played:", error);
        }
      }).catch((error: unknown) => {
        reminderClaims.current.delete(task.id);
        setErrorMessage(error instanceof Error ? error.message : "Pengingat gagal dikirim.");
      });
    }
  }, [now, sessionId, tasks]);

  useEffect(() => () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
  }, []);

  const scheduledTasks = tasks.filter((task) => task.scheduled_time !== null);
  const quickTasks = tasks.filter((task) => task.scheduled_time === null);
  const completedCount = tasks.filter((task) => task.is_completed).length;
  const progress = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
  const currentTime = now ? formatTime(now) : "--:--";

  async function addQuickTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title || !sessionId || !today) return;
    setSaving(true);
    setErrorMessage("");
    try {
      const response = await apiRequest("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, title, task_date: today }),
      });
      if (response.task) setTasks((current) => [...current, response.task!]);
      setQuickTitle("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "To-do gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  function openSchedule(time = currentTime === "--:--" ? "09:00" : currentTime, task: Task | null = null) {
    setEditingQuickTask(task);
    setDraftTitle(task?.title ?? "");
    setDraftTime(time);
    setModalOpen(true);
    setErrorMessage("");
  }

  async function saveScheduledTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title || !sessionId || !today) return;
    setSaving(true);
    setErrorMessage("");
    try {
      if (editingQuickTask) {
        const response = await apiRequest("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingQuickTask.id, session_id: sessionId, title, scheduled_time: draftTime }),
        });
        if (response.task) setTasks((current) => current.map((task) => task.id === response.task!.id ? response.task! : task));
      } else {
        const response = await apiRequest("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, title, task_date: today, scheduled_time: draftTime }),
        });
        if (response.task) setTasks((current) => [...current, response.task!]);
      }
      setModalOpen(false);
      setEditingQuickTask(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Jadwal gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    if (!sessionId) return;
    const updated = { ...task, is_completed: !task.is_completed };
    setTasks((current) => current.map((item) => item.id === task.id ? updated : item));
    try {
      const response = await apiRequest("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, session_id: sessionId, is_completed: updated.is_completed }),
      });
      if (response.task) setTasks((current) => current.map((item) => item.id === task.id ? response.task! : item));
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      setErrorMessage(error instanceof Error ? error.message : "Status tugas gagal diperbarui.");
    }
  }

  async function deleteTask(task: Task) {
    if (!sessionId) return;
    const previous = tasks;
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      await apiRequest("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, session_id: sessionId }),
      });
    } catch (error) {
      setTasks(previous);
      setErrorMessage(error instanceof Error ? error.message : "Tugas gagal dihapus.");
    }
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch (error) {
      console.error("Notification permission request failed:", error);
      setErrorMessage("Izin notifikasi tidak dapat diminta dari browser ini.");
    }
  }

  function goToNow() {
    if (now) timelineRows.current[now.getHours()]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const dateLabel = now
    ? new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)
    : "Hari ini";

  return (
    <main className="min-h-screen px-4 pb-24 pt-5 sm:px-7 sm:pt-8 lg:px-10">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-[#e6e8df] pb-5 sm:mb-9 sm:pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#56744f] text-white shadow-sm">
              <Check size={23} strokeWidth={3} />
            </div>
            <div>
              <div className="text-[25px] font-bold leading-none tracking-[-1.2px]">taskly<span className="text-[#69865f]">.</span></div>
              <p className="mt-1.5 text-[12px] capitalize text-[#858980]">{dateLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => void requestNotificationPermission()}
              disabled={permission === "unsupported" || permission === "granted"}
              title={permission === "granted" ? "Notifikasi aktif" : "Aktifkan notifikasi"}
              className="flex h-10 items-center gap-2 rounded-xl border border-[#e4e6dc] bg-white px-3 text-[13px] font-medium text-[#555b50] transition hover:border-[#bacab4] hover:bg-[#f8faf6] disabled:cursor-default disabled:text-[#67845e]"
            >
              {permission === "granted" ? <Bell size={16} /> : <BellOff size={16} />}
              <span className="hidden sm:inline">{permission === "granted" ? "Notifikasi aktif" : "Izin notifikasi"}</span>
            </button>
            <button
              type="button"
              onClick={() => openSchedule()}
              className="flex h-10 items-center gap-2 rounded-xl bg-[#56744f] px-3.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#45633f] sm:px-4"
            >
              <Plus size={17} strokeWidth={2.5} />
              <span className="hidden sm:inline">Tambah jadwal</span>
              <span className="sm:hidden">Tambah</span>
            </button>
          </div>
        </header>

        <section className="mb-7 rounded-[20px] border border-[#e8e9e1] bg-white px-5 py-5 shadow-[0_3px_15px_rgba(38,45,33,0.025)] sm:px-7 sm:py-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-[#41473e]">Progress harian</p>
              <p className="mt-1 text-[12px] text-[#93968e]">{completedCount} dari {tasks.length} tugas selesai</p>
            </div>
            <span className="text-[23px] font-bold tracking-[-1px] text-[#486642]">{progress}<span className="ml-0.5 text-[14px]">%</span></span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-[#eff0eb]"
            role="progressbar"
            aria-label="Progress harian"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className="h-full rounded-full bg-[#69885f] transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
        </section>

        {errorMessage && (
          <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-[#f1d4ce] bg-[#fff8f6] px-4 py-3 text-[13px] text-[#a34c3c]">
            <span>{errorMessage}</span>
            <button type="button" aria-label="Tutup pesan" onClick={() => setErrorMessage("")}><X size={17} /></button>
          </div>
        )}

        {bannerTask && (
          <div role="status" className="fixed right-4 top-4 z-40 flex max-w-sm items-start gap-3 rounded-2xl border border-[#dce7d7] bg-white p-4 shadow-[0_12px_40px_rgba(30,40,25,0.15)] sm:right-7 sm:top-7">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#edf4e9] text-[#55774e]"><AlarmClock size={19} /></div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#71856a]">Waktunya mulai</p>
              <p className="mt-1 text-[14px] font-semibold text-[#30352d]">{bannerTask.title}</p>
            </div>
            <button type="button" aria-label="Tutup pengingat" onClick={() => setBannerTask(null)} className="text-[#8b9086]"><X size={17} /></button>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.8fr)_minmax(310px,0.9fr)] lg:gap-7">
          <section aria-label="Timeline harian" className="order-2 min-w-0 rounded-[20px] border border-[#e8e9e1] bg-white shadow-[0_3px_15px_rgba(38,45,33,0.025)] lg:order-1">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eff0eb] px-5 py-5 sm:px-7">
              <div>
                <div className="flex items-center gap-2">
                  <Clock3 size={17} className="text-[#69865f]" />
                  <h1 className="text-[16px] font-bold tracking-[-0.2px]">Timeline hari ini</h1>
                </div>
                <p className="mt-1 pl-[25px] text-[12px] text-[#969990]">24 jam · klik slot untuk menambah jadwal</p>
              </div>
              <button type="button" onClick={goToNow} className="flex items-center gap-1.5 rounded-lg border border-[#e7e9e2] px-3 py-2 text-[12px] font-medium text-[#60665c] transition hover:bg-[#f7f8f4]">
                <Clock3 size={14} /> Ke jam sekarang <span className="ml-0.5 text-[#6a8461]">{currentTime}</span>
              </button>
            </div>
            <div className="px-4 pb-4 sm:px-6 sm:pb-5">
              <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center border-b border-[#eff0eb] py-2 text-[10px] font-semibold uppercase tracking-[1px] text-[#a1a39c] sm:grid-cols-[60px_minmax(0,1fr)]">
                <span>Waktu</span><span>Jadwal</span>
              </div>
              <div className="soft-scrollbar">
                {Array.from({ length: 24 }, (_, hour) => {
                  const hourTasks = scheduledTasks.filter((task) => Number(task.scheduled_time?.slice(0, 2)) === hour);
                  const isCurrentHour = now?.getHours() === hour && today === localDateKey(now);
                  const minutesIntoHour = now ? (now.getMinutes() / 60) * 100 : 0;
                  return (
                    <div
                      key={hour}
                      ref={(element) => { timelineRows.current[hour] = element; }}
                      className={`relative grid min-h-[76px] grid-cols-[48px_minmax(0,1fr)] border-b border-[#eff0eb] last:border-0 sm:grid-cols-[60px_minmax(0,1fr)] ${isCurrentHour ? "bg-[#fffdfb]" : ""}`}
                    >
                      <div className="pt-[15px] text-[12px] font-medium tabular-nums text-[#858980]">{String(hour).padStart(2, "0")}:00</div>
                      <div className="relative min-w-0 py-2.5 pl-2">
                        {hourTasks.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => openSchedule(`${String(hour).padStart(2, "0")}:00`)}
                            className="group flex min-h-[52px] w-full items-center rounded-xl px-2 text-left text-[12px] text-transparent transition hover:bg-[#f8faf6] hover:text-[#84977c] focus-visible:bg-[#f8faf6] focus-visible:text-[#84977c] focus-visible:outline-none"
                            aria-label={`Tambah tugas pukul ${String(hour).padStart(2, "0")}:00`}
                          >
                            <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Plus size={14} /> Tambah jadwal</span>
                          </button>
                        ) : (
                          <div className="space-y-1.5">
                            {hourTasks.map((task) => (
                              <div key={task.id} className={`group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${task.is_completed ? "border-[#eef0ea] bg-[#fafbf8]" : "border-[#e8ece4] bg-[#f7f9f5]"}`}>
                                <button
                                  type="button"
                                  onClick={() => void toggleTask(task)}
                                  aria-label={task.is_completed ? `Tandai ${task.title} belum selesai` : `Tandai ${task.title} selesai`}
                                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition ${task.is_completed ? "border-[#69865f] bg-[#69865f] text-white" : "border-[#c9cec2] bg-white hover:border-[#69865f]"}`}
                                >
                                  {task.is_completed && <Check size={12} strokeWidth={3} />}
                                </button>
                                <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${task.is_completed ? "text-[#a0a49a] line-through" : "text-[#3e443b]"}`}>{task.title}</span>
                                <span className="shrink-0 rounded-md bg-white/80 px-1.5 py-1 text-[10px] tabular-nums text-[#83887e]">{task.scheduled_time}</span>
                                <button type="button" onClick={() => void deleteTask(task)} aria-label={`Hapus ${task.title}`} className="shrink-0 text-[#b2b5ae] opacity-100 transition hover:text-[#bb5d4e] sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={14} /></button>
                              </div>
                            ))}
                            <button type="button" onClick={() => openSchedule(`${String(hour).padStart(2, "0")}:00`)} className="flex items-center gap-1 px-2 py-1 text-[11px] text-[#9a9e95] transition hover:text-[#56744f]"><Plus size={12} /> Tambah</button>
                          </div>
                        )}
                        {isCurrentHour && (
                          <div className="current-time-line" style={{ top: `${Math.min(minutesIntoHour, 96)}%` }}>
                            <span className="absolute -top-[10px] right-0 rounded bg-[#de6d60] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white">{currentTime}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="order-1 min-w-0 lg:sticky lg:top-6 lg:order-2">
            <details open className="group rounded-[20px] border border-[#e8e9e1] bg-white shadow-[0_3px_15px_rgba(38,45,33,0.025)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-5 sm:px-6 [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f2f4ed] text-[#6f8666]"><Sparkles size={17} /></div>
                  <div>
                    <h2 className="text-[15px] font-bold">Quick to-do</h2>
                    <p className="mt-0.5 text-[11px] text-[#969990]">Tanpa jam · {quickTasks.length} tugas</p>
                  </div>
                </div>
                <ChevronDown size={17} className="text-[#8d9288] transition group-open:rotate-180 lg:hidden" />
              </summary>
              <div className="border-t border-[#eff0eb] px-5 pb-5 pt-4 sm:px-6">
                <form onSubmit={(event) => void addQuickTask(event)} className="flex items-center gap-2 rounded-xl border border-[#e7e9e2] bg-[#fbfcf9] p-1.5 pl-3 transition focus-within:border-[#b8c8b1] focus-within:ring-2 focus-within:ring-[#e7efe4]">
                  <input
                    value={quickTitle}
                    onChange={(event) => setQuickTitle(event.target.value)}
                    maxLength={255}
                    placeholder="Tulis tugas singkat..."
                    aria-label="Tugas tanpa jadwal"
                    className="min-w-0 flex-1 bg-transparent py-2 text-[13px] text-[#30352d] outline-none placeholder:text-[#afb2aa]"
                  />
                  <button type="submit" disabled={!quickTitle.trim() || saving} aria-label="Tambah to-do" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#56744f] text-white transition hover:bg-[#45633f] disabled:cursor-not-allowed disabled:opacity-40"><Plus size={17} /></button>
                </form>

                <div className="mt-3 space-y-1">
                  {quickTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#e8eae4] px-4 py-7 text-center">
                      <p className="text-[12px] font-medium text-[#747a70]">Ruang untuk hal-hal kecil.</p>
                      <p className="mt-1 text-[11px] text-[#a1a49d]">Tambahkan to-do pertamamu di atas.</p>
                    </div>
                  ) : quickTasks.map((task) => (
                    <div key={task.id} className="group/item flex items-center gap-2.5 rounded-xl px-2 py-2.5 transition hover:bg-[#f8f9f6]">
                      <button
                        type="button"
                        onClick={() => void toggleTask(task)}
                        aria-label={task.is_completed ? `Tandai ${task.title} belum selesai` : `Tandai ${task.title} selesai`}
                        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition ${task.is_completed ? "border-[#69865f] bg-[#69865f] text-white" : "border-[#c9cec2] bg-white hover:border-[#69865f]"}`}
                      >
                        {task.is_completed && <Check size={12} strokeWidth={3} />}
                      </button>
                      <span className={`min-w-0 flex-1 break-words text-[13px] leading-5 ${task.is_completed ? "text-[#a0a49a] line-through" : "text-[#50564c]"}`}>{task.title}</span>
                      <button type="button" onClick={() => openSchedule(currentTime === "--:--" ? "09:00" : currentTime, task)} aria-label={`Jadwalkan ${task.title}`} title="Jadwalkan" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#9a9e95] transition hover:bg-[#edf3e9] hover:text-[#56744f]"><CalendarDays size={15} /></button>
                      <button type="button" onClick={() => void deleteTask(task)} aria-label={`Hapus ${task.title}`} title="Hapus" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#b0b3ac] transition hover:bg-[#fff0ed] hover:text-[#bc6251]"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>

                {tasks.length > 0 && (
                  <div className="mt-4 flex items-center justify-between border-t border-[#eff0eb] pt-3 text-[11px] text-[#999d94]">
                    <span>{quickTasks.filter((task) => !task.is_completed).length} tersisa</span>
                    <span>{scheduledTasks.length} terjadwal hari ini</span>
                  </div>
                )}
              </div>
            </details>

            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-[#edf2e9] px-4 py-3.5 text-[11px] leading-[1.65] text-[#71816b]">
              <AlarmClock size={15} className="mt-0.5 shrink-0" />
              <p>Pengingat berbunyi saat Taskly terbuka. Izinkan notifikasi agar pengingat juga muncul di browser.</p>
            </div>
          </aside>
        </div>

        <button type="button" onClick={() => openSchedule()} aria-label="Tambah jadwal" className="fixed bottom-5 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-[#56744f] text-white shadow-[0_8px_24px_rgba(50,74,45,0.3)] transition hover:scale-105 hover:bg-[#45633f] sm:bottom-7 sm:right-7 lg:hidden"><Plus size={25} /></button>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1f251d]/35 px-4 py-6 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
          <form onSubmit={(event) => void saveScheduledTask(event)} className="w-full max-w-[430px] rounded-[22px] border border-[#eceee7] bg-white p-6 shadow-[0_20px_70px_rgba(29,38,26,0.2)] sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[1.2px] text-[#7b916f]">{editingQuickTask ? "Pindahkan ke timeline" : "Rencanakan waktumu"}</p>
                <h2 className="mt-1.5 text-[21px] font-bold tracking-[-0.6px]">{editingQuickTask ? "Jadwalkan tugas" : "Tambah jadwal"}</h2>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Tutup" className="rounded-lg p-1.5 text-[#92968d] hover:bg-[#f4f5f1]"><X size={18} /></button>
            </div>
            <label className="mb-4 block text-[12px] font-semibold text-[#64695f]">
              Nama tugas
              <input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} maxLength={255} required placeholder="Misalnya: Review tugas akhir" className="mt-2 h-11 w-full rounded-xl border border-[#e5e8df] bg-[#fcfcfa] px-3.5 text-[14px] font-normal text-[#33382f] outline-none transition placeholder:text-[#b2b5ae] focus:border-[#9db394] focus:ring-2 focus:ring-[#edf3e9]" />
            </label>
            <label className="mb-6 block text-[12px] font-semibold text-[#64695f]">
              Jam
              <input type="time" value={draftTime} onChange={(event) => setDraftTime(event.target.value)} required className="mt-2 h-11 w-full rounded-xl border border-[#e5e8df] bg-[#fcfcfa] px-3.5 text-[14px] font-normal text-[#33382f] outline-none focus:border-[#9db394] focus:ring-2 focus:ring-[#edf3e9]" />
            </label>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setModalOpen(false)} className="h-11 flex-1 rounded-xl border border-[#e5e8df] text-[13px] font-semibold text-[#62675e] transition hover:bg-[#f8f9f6]">Batal</button>
              <button type="submit" disabled={!draftTitle.trim() || saving} className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-[#56744f] text-[13px] font-semibold text-white transition hover:bg-[#45633f] disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} />{saving ? "Menyimpan..." : "Simpan jadwal"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
