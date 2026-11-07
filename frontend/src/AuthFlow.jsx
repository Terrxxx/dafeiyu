import React, { useEffect, useState } from "react";
import CaptchaDialog from "./CaptchaDialog.jsx";
import { api, Field, Form, ErrorBox } from "./shared.jsx";
// Keep one active registration field and one primary action; reuse existing theme and form controls.
export default function AuthFlow({ mode, registration, onSuccess }) {
  const [step, setStep] = useState(0),
    [values, setValues] = useState({
      username: "",
      email: "",
      password: "",
      passwordConfirm: "",
      invite: "",
    }),
    [identifier, setIdentifier] = useState(""),
    [method, setMethod] = useState("password"),
    [code, setCode] = useState(""),
    [issued, setIssued] = useState(null),
    [sending, setSending] = useState(false),
    [notice, setNotice] = useState(""),
    [sendError, setSendError] = useState(""),
    [registrationCode, setRegistrationCode] = useState(""),
    [registrationChallenge, setRegistrationChallenge] = useState(""),
    [registrationProof, setRegistrationProof] = useState(""),
    [registrationRetryAt, setRegistrationRetryAt] = useState(0),
    [captcha, setCaptcha] = useState(null),
    [captchaAnswer, setCaptchaAnswer] = useState(""),
    [captchaError, setCaptchaError] = useState(""),
    [captchaBusy, setCaptchaBusy] = useState(false),
    [loginCaptcha, setLoginCaptcha] = useState(null),
    [loginCaptchaAction, setLoginCaptchaAction] = useState(""),
    [pendingPassword, setPendingPassword] = useState(""),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!issued && !registrationRetryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [issued, registrationRetryAt]);
  const emailInput = identifier.includes("@"),
    useCode = emailInput && method === "code",
    wait = issued ? Math.max(0, Math.ceil((issued.retryAt - now) / 1000)) : 0;
  const steps = [
      "用户名",
      "邮箱",
      "邮箱验证码",
      "设置密码",
      "确认密码",
      ...(registration?.registrationMode === "invite" ? ["邀请码"] : []),
    ],
    fields = [
      "username",
      "email",
      "registrationCode",
      "password",
      "passwordConfirm",
      "invite",
    ];
  const change = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key === "username" || key === "email") {
      setRegistrationProof("");
      setRegistrationChallenge("");
      setRegistrationCode("");
    }
  };
  async function openCaptcha() {
    const result = await api("/auth/register/captcha", {
      username: values.username,
      email: values.email,
    });
    setCaptcha(result);
    setCaptchaAnswer("");
    setCaptchaError("");
  }
  async function solveCaptcha(event) {
    event.preventDefault();
    setCaptchaBusy(true);
    setCaptchaError("");
    try {
      await requestRegistrationCode(captcha.challenge, captchaAnswer);
      setCaptcha(null);
    } catch (error) {
      await openCaptcha().catch(() => {});
      setCaptchaError(error.message);
    } finally {
      setCaptchaBusy(false);
    }
  }
  async function requestRegistrationCode(captchaChallenge, captchaAnswer) {
    const result = await api("/auth/register/code/request", {
      username: values.username,
      email: values.email,
      captchaChallenge,
      captchaAnswer,
    });
    setRegistrationChallenge(result.challenge);
    setRegistrationCode("");
    const at = Date.now();
    setNow(at);
    setRegistrationRetryAt(at + result.retryAfter * 1000);
    setStep(2);
  }
  async function next() {
    if (step === 0) {
      const result = await api("/auth/username", { username: values.username });
      if (!result.available) throw Error("用户名已被使用");
    }
    if (step === 1) {
      if (registration?.captcha?.registrationEnabled === false)
        await requestRegistrationCode();
      else await openCaptcha();
      return;
    }
    if (step === 2) {
      const result = await api("/auth/register/code/verify", {
        username: values.username,
        email: values.email,
        challenge: registrationChallenge,
        code: registrationCode,
      });
      setRegistrationProof(result.proof);
      setStep(3);
      return;
    }
    if (step === 4 && values.password !== values.passwordConfirm)
      throw Error("两次输入的密码不一致");
    if (step < steps.length - 1) {
      setStep(step + 1);
      return;
    }
    await onSuccess(
      await api("/auth/register", { ...values, proof: registrationProof }),
    );
  }
  async function send(captchaChallenge, captchaAnswer) {
    setSending(true);
    setSendError("");
    setNotice("");
    try {
      const response = await api("/auth/login-code/request", {
        email: identifier.trim(),
        captchaChallenge,
        captchaAnswer,
      });
      const at = Date.now();
      setNow(at);
      setIssued({
        ...response,
        email: identifier.trim(),
        retryAt: at + response.retryAfter * 1000,
      });
      setCode("");
      setNotice(response.message);
    } catch (e) {
      setSendError(e.message);
      throw e;
    } finally {
      setSending(false);
    }
  }
  async function openLoginCaptcha(action) {
    const result = await api("/auth/login/captcha", {
      username: identifier.trim(),
    });
    setLoginCaptchaAction(action);
    setLoginCaptcha(result);
    setCaptchaAnswer("");
    setCaptchaError("");
  }
  async function solveLoginCaptcha(event) {
    event.preventDefault();
    setCaptchaBusy(true);
    setCaptchaError("");
    try {
      if (loginCaptchaAction === "code")
        await send(loginCaptcha.challenge, captchaAnswer);
      else
        await onSuccess(
          await api("/auth/login", {
            username: identifier,
            password: pendingPassword,
            captchaChallenge: loginCaptcha.challenge,
            captchaAnswer,
          }),
        );
      setLoginCaptcha(null);
    } catch (error) {
      setCaptchaError(error.message);
    } finally {
      setCaptchaBusy(false);
    }
  }
  if (mode === "register") {
    const key = fields[step];
    return (
      <>
        <div className="registration-progress" aria-label="注册进度">
          <span>
            第 {step + 1} / {steps.length} 步
          </span>
          <strong>{steps[step]}</strong>
        </div>
        {step > 0 && (
          <p className="registration-identity">
            账号：{values.username}
            {step > 1 ? " · " + values.email : ""}
          </p>
        )}
        <Form
          key={step}
          disabled={!registration || registration.registrationMode === "closed"}
          submit={next}
        >
          <div className="auth-step" key={step}>
            {step === 2 ? (
              <div className="login-code-row">
                <Field
                  autoFocus
                  label="邮箱验证码"
                  name="registrationCode"
                  value={registrationCode}
                  onChange={(e) =>
                    setRegistrationCode(
                      e.target.value.replace(/[^0-9]/g, "").slice(0, 6),
                    )
                  }
                  required
                  pattern="[0-9]{6}"
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  hint="10 分钟内有效，验证后再设置密码"
                />
                <button
                  type="button"
                  disabled={now < registrationRetryAt}
                  onClick={() =>
                    (registration?.captcha?.registrationEnabled === false
                      ? requestRegistrationCode()
                      : openCaptcha()
                    ).catch((e) => setCaptchaError(e.message))
                  }
                >
                  {now < registrationRetryAt
                    ? Math.ceil((registrationRetryAt - now) / 1000) + "秒后重发"
                    : "重新发送"}
                </button>
              </div>
            ) : (
              <Field
                autoFocus
                label={steps[step]}
                name={key}
                value={values[key]}
                onChange={(e) => change(key, e.target.value)}
                type={
                  step === 1
                    ? "email"
                    : step === 3 || step === 4
                      ? "password"
                      : "text"
                }
                required
                pattern={step === 0 ? "[a-z][a-z0-9_]{2,23}" : undefined}
                minLength={
                  step === 0 ? 3 : step === 3 || step === 4 ? 12 : undefined
                }
                maxLength={
                  step === 0
                    ? 24
                    : step === 1
                      ? 254
                      : step === 3 || step === 4
                        ? 128
                        : undefined
                }
                autoComplete={
                  step === 0
                    ? "username"
                    : step === 1
                      ? "email"
                      : step === 3 || step === 4
                        ? "new-password"
                        : "off"
                }
                hint={
                  step === 0
                    ? "3–24 位小写字母、数字或下划线，以字母开头"
                    : step === 1
                      ? "验证绑定成功后，邮箱不可更换。"
                      : step === 3
                        ? "12–128 个字符"
                        : undefined
                }
              />
            )}
          </div>
          <button className="primary">
            {step === steps.length - 1 ? "创建账号" : "下一步"}
          </button>
          {step > 0 && (
            <button
              type="button"
              className="auth-back"
              onClick={() => setStep(step - 1)}
            >
              ← 上一步
            </button>
          )}
        </Form>
        <CaptchaDialog
          challenge={captcha}
          value={captchaAnswer}
          onChange={setCaptchaAnswer}
          onRefresh={() =>
            openCaptcha().catch((error) => setCaptchaError(error.message))
          }
          onCancel={() => setCaptcha(null)}
          onSubmit={solveCaptcha}
          error={captchaError}
          busy={captchaBusy}
          actionLabel="发送邮箱验证码"
        />
      </>
    );
  }
  if (mode === "activate")
    return (
      <Form
        submit={async (v) =>
          onSuccess(
            await api("/auth/activate", {
              password: v.password,
              token: location.hash.slice(1),
            }),
          )
        }
      >
        <Field
          label="设置密码"
          name="password"
          type="password"
          required
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          hint="12–128 个字符"
        />
        <button className="primary">设置密码并登录</button>
      </Form>
    );
  return (
    <>
      <Form
        disabled={sending}
        submit={async (v) => {
          if (useCode) {
            if (!issued || issued.email !== identifier.trim())
              throw Error("请先获取邮箱验证码");
            await onSuccess(
              await api("/auth/login-code/verify", {
                email: identifier.trim(),
                challenge: issued.challenge,
                code,
              }),
            );
          } else if (registration?.captcha?.loginEnabled) {
            setPendingPassword(v.password);
            await openLoginCaptcha("password");
          } else
            await onSuccess(
              await api("/auth/login", {
                username: identifier,
                password: v.password,
              }),
            );
        }}
      >
        <Field
          label="用户名或邮箱"
          name="username"
          required
          maxLength={254}
          autoComplete="username"
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            setIssued(null);
            setCode("");
            setNotice("");
            setSendError("");
          }}
        />
        {emailInput && (
          <div
            className="tabs auth-login-methods"
            role="tablist"
            aria-label="登录方式"
          >
            {[
              ["password", "密码登录"],
              ["code", "邮箱验证码"],
            ].map(([key, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={method === key}
                key={key}
                onClick={() => {
                  setMethod(key);
                  setSendError("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {useCode ? (
          <>
            <div className="login-code-row">
              <Field
                label="邮箱验证码"
                name="code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
                }
                required
                pattern="[0-9]{6}"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
              <button
                type="button"
                onClick={() =>
                  (registration?.captcha?.loginEnabled
                    ? openLoginCaptcha("code")
                    : send()
                  ).catch((e) => setSendError(e.message))
                }
                disabled={sending || wait > 0}
              >
                {sending
                  ? "正在发送…"
                  : wait > 0
                    ? wait + "秒后重发"
                    : issued
                      ? "重新发送"
                      : "获取验证码"}
              </button>
            </div>
            {notice && (
              <p className="muted" role="status">
                {notice}
              </p>
            )}
            <ErrorBox>{sendError}</ErrorBox>
          </>
        ) : (
          <Field
            label="密码"
            name="password"
            type="password"
            required
            minLength={1}
            maxLength={128}
            autoComplete="current-password"
          />
        )}
        <button className="primary">登录工作空间</button>
      </Form>
      <CaptchaDialog
        challenge={loginCaptcha}
        value={captchaAnswer}
        onChange={setCaptchaAnswer}
        onRefresh={() =>
          openLoginCaptcha(loginCaptchaAction).catch((error) =>
            setCaptchaError(error.message),
          )
        }
        onCancel={() => setLoginCaptcha(null)}
        onSubmit={solveLoginCaptcha}
        error={captchaError}
        busy={captchaBusy}
        actionLabel={
          loginCaptchaAction === "code" ? "发送登录验证码" : "登录工作空间"
        }
      />
    </>
  );
}
