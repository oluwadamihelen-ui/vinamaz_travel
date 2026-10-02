"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./form";

/** Password field with a show/hide toggle (large touch target, announced to screen readers). */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(({ className, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} className={`pr-12 ${className ?? ""}`} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-ink-3 hover:bg-sand hover:text-ink"
      >
        {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
