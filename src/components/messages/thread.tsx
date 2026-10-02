"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { sendMessageAction } from "@/lib/actions/messages";
import { uploadFile } from "@/lib/client/upload";
import { cn } from "@/lib/utils";

export interface ThreadMessage {
  id: string;
  body: string;
  senderName: string;
  mine: boolean;
  createdAt: string;
  isNew: boolean;
  attachments: { id: string; filename: string; sizeBytes: number }[];
}

interface Pending { uploadId: string; filename: string }

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

export function MessageThread({ applicationId, messages, canSend, emptyHint }: { applicationId: string; messages: ThreadMessage[]; canSend: boolean; emptyHint: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // Pick up new replies without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30_000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  async function attach(f: File) {
    setError(null);
    setProgress(0);
    try {
      const r = await uploadFile<{ uploadId: string; filename: string }>({ kind: "MESSAGE_ATTACHMENT", applicationId, file: f, onProgress: setProgress });
      setPending((p) => [...p, { uploadId: r.uploadId, filename: r.filename }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be attached.");
    } finally {
      setProgress(null);
      if (file.current) file.current.value = "";
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (sending || (!body.trim() && pending.length === 0)) return;
    setSending(true);
    setError(null);
    const res = await sendMessageAction(applicationId, body, pending.map((p) => p.uploadId));
    setSending(false);
    if (res.error) return setError(res.error);
    setBody("");
    setPending([]);
    router.refresh();
  }

  return (
    <div>
      <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-2xl bg-paper p-4" role="log" aria-label="Messages" aria-live="polite">
        {messages.length === 0 && <p className="py-6 text-center text-sm text-ink-3">{emptyHint}</p>}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 text-sm", m.mine ? "bg-ink text-white" : "border border-line bg-white")}>
              <p className={cn("mb-1 text-xs", m.mine ? "text-white/70" : "text-ink-3")}>{m.mine ? "You" : m.senderName} · {fmtTime(m.createdAt)}{m.isNew && <span className="ml-2 rounded-full bg-gold-bright px-2 py-0.5 text-[10px] font-semibold text-ink">New</span>}</p>
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              {m.attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {m.attachments.map((a) => (
                    <li key={a.id}><a className={cn("inline-flex items-center gap-1.5 underline", m.mine ? "text-white" : "text-brand")} href={`/api/messages/attachments/${a.id}`}><Paperclip className="size-3.5" />{a.filename} <span className="opacity-70">({fmtSize(a.sizeBytes)})</span></a></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      {canSend ? (
        <form onSubmit={send} className="mt-4 space-y-3">
          {error && <Alert>{error}</Alert>}
          <label htmlFor={`msg-${applicationId}`} className="sr-only">Your message</label>
          <Textarea id={`msg-${applicationId}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="Write a message…" className="min-h-24" />
          {pending.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {pending.map((p) => (
                <li key={p.uploadId} className="flex items-center gap-1.5 rounded-full bg-sand px-3 py-1 text-xs"><Paperclip className="size-3" />{p.filename}<button type="button" aria-label={`Remove ${p.filename}`} onClick={() => setPending((x) => x.filter((y) => y.uploadId !== p.uploadId))}><X className="size-3" /></button></li>
              ))}
            </ul>
          )}
          {progress !== null && <p className="text-xs text-ink-3">Uploading attachment… {progress}%</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <input ref={file} type="file" id={`att-${applicationId}`} className="sr-only" accept="application/pdf,image/jpeg,image/png" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); }} />
              <Button type="button" variant="outline" size="sm" disabled={progress !== null || pending.length >= 5} onClick={() => file.current?.click()}><Paperclip className="size-4" />Attach file</Button>
              <span className="ml-2 text-xs text-ink-3">PDF, JPG or PNG, up to 10MB</span>
            </div>
            <Button type="submit" disabled={sending || progress !== null || (!body.trim() && pending.length === 0)}><Send className="size-4" />{sending ? "Sending…" : "Send"}</Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm text-ink-3">You can read this conversation but don&rsquo;t have permission to reply.</p>
      )}
    </div>
  );
}
