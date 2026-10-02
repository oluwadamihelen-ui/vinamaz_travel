"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { uploadFile } from "@/lib/client/upload";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE } from "@/lib/applications/labels";
import type { DocumentStatus } from "@/generated/prisma/enums";

export interface SlotDoc { id: string; originalFilename: string; sizeBytes: number; status: DocumentStatus; rejectionReason: string | null }
export interface SlotProps {
  applicationId: string;
  slot: { key: string; name: string; description: string | null; isRequired: boolean; acceptedFormats: string[]; maxSizeMb: number };
  current: SlotDoc | null;
  canUpload: boolean;
  error?: string;
}

export function DocumentSlot({ applicationId, slot, current, canUpload, error }: SlotProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const limit = slot.maxSizeMb;
  const approved = current?.status === "APPROVED";

  async function upload(file: File) {
    setMessage(null);
    if (file.size > slot.maxSizeMb * 1024 * 1024) {
      setMessage(`That file is too large. The maximum size is ${slot.maxSizeMb}MB.`);
      return;
    }
    setProgress(0);
    try {
      await uploadFile({ kind: "DOCUMENT", applicationId, requirementKey: slot.key, file, onProgress: setProgress });
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Your document upload failed. Please try again.");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{slot.name}</p>
          {slot.description && <p className="mt-0.5 text-sm text-ink-3">{slot.description}</p>}
        </div>
        <Badge tone={slot.isRequired ? "gold" : "neutral"}>{slot.isRequired ? "Required" : "Optional"}</Badge>
      </div>
      <p className="mt-2 text-xs text-ink-3">{slot.acceptedFormats.map((f) => f.toUpperCase()).join(", ")} · Maximum {limit}MB</p>

      {current && (
        <div className="mt-4 rounded-xl bg-paper p-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {current.status === "REPLACEMENT_REQUIRED" || current.status === "REJECTED" ? <FileText className="size-5 text-gold" /> : <CheckCircle2 className="size-5 text-ok" />}
            <a className="min-w-0 flex-1 basis-40 truncate font-medium text-brand hover:underline" href={`/api/documents/${current.id}`}>{current.originalFilename}</a>
            <Badge tone={DOC_STATUS_TONE[current.status]}>{current.status === "UPLOADED" ? "Uploaded · under review soon" : DOC_STATUS_LABEL[current.status]}</Badge>
          </div>
          {current.rejectionReason && <p className="mt-2 text-sm text-gold"><strong>Reason:</strong> {current.rejectionReason}</p>}
        </div>
      )}

      {progress !== null && (
        <div className="mt-4" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Uploading ${slot.name}`}>
          <div className="h-2 overflow-hidden rounded-full bg-sand"><div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} /></div>
          <p className="mt-1 text-xs text-ink-3">Uploading… {progress}%</p>
        </div>
      )}
      {(message || error) && <p role="alert" className="mt-3 text-sm font-medium text-danger">{message ?? error}</p>}

      {canUpload && !approved && (
        <div className="mt-4">
          <input ref={input} type="file" className="sr-only" id={`file-${slot.key}`} accept={slot.acceptedFormats.map((f) => (f === "pdf" ? "application/pdf" : f === "jpg" ? "image/jpeg" : "image/png")).join(",")}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <Button type="button" variant={current ? "outline" : "primary"} disabled={progress !== null} onClick={() => input.current?.click()} className="w-full sm:w-auto">
            <Upload className="size-4" />{current ? "Replace document" : "Upload document"}
          </Button>
        </div>
      )}
    </div>
  );
}
