import React, { useState } from "react";
import {
  api,
  useData,
  Field,
  Form,
  ErrorBox,
  Empty,
  setCSRF,
} from "./shared.jsx";
import CaptchaDialog from "./CaptchaDialog.jsx";

export default function PasswordChange({ notify }) {
  const [options] = useData("/auth/options"),
    [email] = useData("/account/email");
  const [current, setCurrent] = useState(""),
    [issued, setIssued] = useState(null),
    [code, setCode] = useState(""),
    [proof, setProof] = useState("");
  const [captcha, setCaptcha] = useState(null),
    [captchaAnswer, setCaptchaAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!options || !email) return <Empty>正在读取安全设置…</Empty>;
  async function send(challenge, answer) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/account/password/code/request", {
        current,
        captchaChallenge: challenge,
        captchaAnswer: answer,
      });
      setIssued(result);
      setCode("");
      setCaptcha(null);
      notify("修改密码验证码已发送至绑定邮箱");
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function request() {
    if (!current) throw Error("请先输入当前密码");
    if (options.captcha?.passwordEnabled) {
      const result = await api("/account/password/captcha", {});
      setCaptcha(result);
      setCaptchaAnswer("");
      setError("");
    } else await send();
  }
  async function solve(event) {
    event.preventDefault();
    try {
      await send(captcha.challenge, captchaAnswer);
    } catch {}
  }
  if (!email.verified)
    return <p className="muted">请先绑定并验证邮箱，才能修改登录密码。</p>;
  return (
    <div className="stack">
      {!issued && !proof && (
        <Form submit={request}>
          <p className="muted">
            验证码将发送至 {email.email}，验证后才能设置新密码。
          </p>
          <Field
            label="当前密码"
            name="current"
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <button className="primary" disabled={busy}>
            发送邮箱验证码
          </button>
        </Form>
      )}
      {issued && !proof && (
        <Form
          submit={async () => {
            const result = await api("/account/password/code/verify", {
              challenge: issued.challenge,
              code,
            });
            setProof(result.proof);
            setError("");
          }}
        >
          <p className="muted">验证码 10 分钟内有效。</p>
          <Field
            label="邮箱验证码"
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))
            }
            required
            pattern="[0-9]{6}"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <button className="primary">验证邮箱</button>
          <button
            type="button"
            className="auth-back"
            onClick={() => {
              setIssued(null);
              setCode("");
            }}
          >
            重新获取
          </button>
        </Form>
      )}
      {proof && (
        <Form
          submit={async (values) => {
            if (values.password !== values.confirm)
              throw Error("两次密码不一致");
            await api("/account/password", {
              current,
              password: values.password,
              proof,
            });
            setCSRF((await api("/auth/me")).csrf);
            setCurrent("");
            setProof("");
            setIssued(null);
            notify("密码已更新，其他会话已退出");
          }}
        >
          <p className="muted">邮箱已验证，请设置新密码。</p>
          <Field
            label="新密码"
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            required
            autoComplete="new-password"
          />
          <Field
            label="确认新密码"
            name="confirm"
            type="password"
            minLength={12}
            maxLength={128}
            required
            autoComplete="new-password"
          />
          <button className="primary">更新密码</button>
        </Form>
      )}
      <ErrorBox>{error}</ErrorBox>
      <CaptchaDialog
        challenge={captcha}
        value={captchaAnswer}
        onChange={setCaptchaAnswer}
        onRefresh={() =>
          api("/account/password/captcha", {})
            .then((result) => {
              setCaptcha(result);
              setCaptchaAnswer("");
              setError("");
            })
            .catch((e) => setError(e.message))
        }
        onCancel={() => setCaptcha(null)}
        onSubmit={solve}
        error={error}
        busy={busy}
        actionLabel="发送邮箱验证码"
      />
    </div>
  );
}
