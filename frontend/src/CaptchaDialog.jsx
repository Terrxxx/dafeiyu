import React from "react";
import { Field, ErrorBox } from "./shared.jsx";
export default function CaptchaDialog({
  challenge,
  value,
  onChange,
  onRefresh,
  onCancel,
  onSubmit,
  error,
  busy,
  actionLabel = "继续",
}) {
  if (!challenge) return null;
  const length = challenge.length || 5;
  return (
    <div
      className="captcha-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="captcha-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="人机验证"
        onSubmit={onSubmit}
      >
        <h3>先完成人机验证</h3>
        <p className="muted">
          输入图片中的 {length} 位字符，字母不区分大小写。
        </p>
        <img src={challenge.image} alt="图形验证码" width="174" height="58" />
        <button type="button" className="auth-back" onClick={onRefresh}>
          换一张图片
        </button>
        <Field
          autoFocus
          label="图片中的字符"
          value={value}
          onChange={(event) =>
            onChange(
              event.target.value.replace(/[^a-z0-9]/gi, "").slice(0, length),
            )
          }
          required
          pattern={`[A-Za-z0-9]{${length}}`}
          maxLength={length}
          autoComplete="off"
        />
        <ErrorBox>{error}</ErrorBox>
        <div className="captcha-actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "正在验证…" : actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
