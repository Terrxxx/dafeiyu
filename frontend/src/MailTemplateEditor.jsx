// Primary: edit the mail body; secondary: formatting and preview. Reuse theme tokens, 8/16/24 spacing and existing fields; template HTML is sanitized by the server before entering the visual editor.
import React, { useEffect, useRef, useState } from "react";
import { api, Field, ErrorBox, markDirty } from "./shared.jsx";
import verificationDefaults from "../../src/mail-template-defaults.json";
import loginDefaults from "../../src/login-mail-template-defaults.json";
import registrationDefaults from "../../src/registration-mail-template-defaults.json";
import passwordDefaults from "../../src/password-mail-template-defaults.json";
const verificationVariables = [
  ["site_name", "站点名"],
  ["username", "用户名"],
  ["action_label", "操作名称"],
  ["purpose", "邮件用途"],
  ["expires_hours", "有效小时"],
  ["verification_url", "验证链接"],
];
export default function MailTemplateEditor({
  value,
  onChange,
  kind = "verification",
}) {
  const defaults =
    kind === "login"
      ? loginDefaults
      : kind === "registration"
        ? registrationDefaults
        : kind === "password"
          ? passwordDefaults
          : verificationDefaults;
  value = value ?? defaults;
  const variables =
    kind !== "verification"
      ? [
          ["site_name", "站点名"],
          ["username", "用户名"],
          [
            "login_code",
            kind === "registration"
              ? "注册验证码"
              : kind === "password"
                ? "改密验证码"
                : "登录验证码",
          ],
          ["expires_minutes", "有效分钟"],
        ]
      : verificationVariables;
  const [mode, setMode] = useState("source"),
    [preview, setPreview] = useState(null),
    [safeSource, setSafeSource] = useState(""),
    [error, setError] = useState("");
  const source = useRef(null),
    editor = useRef(null),
    selection = useRef(null);
  const change = (next) => {
    markDirty();
    onChange(next);
  };
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        api("/admin/settings/mail-preview", { template: value, kind })
          .then((r) => {
            if (alive) {
              setPreview(r);
              setError("");
            }
          })
          .catch((e) => {
            if (alive) setError(e.message);
          }),
      500,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [value.subject, value.html, value.text, kind]);
  const remember = () => {
    const s = getSelection();
    if (s?.rangeCount && editor.current?.contains(s.anchorNode))
      selection.current = s.getRangeAt(0).cloneRange();
  };
  async function switchMode(next) {
    if (next === "source") {
      setMode(next);
      return;
    }
    try {
      const draft = {
        ...value,
        html:
          mode === "rich" && editor.current
            ? editor.current.innerHTML
            : value.html,
      };
      const result = await api("/admin/settings/mail-preview", {
        template: draft,
        kind,
      });
      setPreview(result);
      setSafeSource(result.editorHtml);
      setError("");
      setMode(next);
    } catch (e) {
      setError(e.message);
    }
  }
  function insert(clean, selectedOnly = false) {
    if (mode === "source") {
      const el = source.current,
        a = el.selectionStart,
        b = el.selectionEnd;
      if (selectedOnly && a === b) {
        setError("请先选中需要格式化的文字");
        return;
      }
      const next =
        value.html.slice(0, a) +
        clean(value.html.slice(a, b)) +
        value.html.slice(b);
      change({ ...value, html: next });
      el.focus();
      return;
    }
    const el = editor.current;
    if (!el) return;
    let range = selection.current;
    if (!range || !el.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    if (selectedOnly && range.collapsed) {
      setError("请先选中需要格式化的文字");
      return;
    }
    const current = range.cloneContents(),
      container = document.createElement("div");
    container.append(current);
    const fragment = range.createContextualFragment(clean(container.innerHTML));
    range.deleteContents();
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(range);
      selection.current = range.cloneRange();
    }
    change({ ...value, html: el.innerHTML });
    el.focus();
    setError("");
  }
  const wrap = (tag, style = "") =>
    insert(
      (text) =>
        "<" +
        tag +
        (style ? ' style="' + style + '"' : "") +
        ">" +
        text +
        "</" +
        tag +
        ">",
      true,
    );
  async function paste(event) {
    event.preventDefault();
    remember();
    const html = event.clipboardData.getData("text/html"),
      text = event.clipboardData.getData("text/plain");
    if (html) {
      try {
        const result = await api("/admin/settings/mail-preview", {
          template: { ...value, html, text: "" },
          kind,
        });
        insert(() => result.editorHtml);
      } catch (e) {
        setError(e.message);
      }
    } else
      insert(() =>
        text
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll("\n", "<br>"),
      );
  }
  return (
    <section className="mail-template">
      <h3>{kind === "verification" ? "验证邮件内容" : "验证码邮件内容"}</h3>
      <Field
        label="邮件主题"
        value={value.subject}
        maxLength={200}
        onChange={(e) => change({ ...value, subject: e.target.value })}
      />
      <div className="template-variables">
        {variables.map(([key, label]) => (
          <span key={key}>
            {label} <code>{"{{" + key + "}}"}</code>
          </span>
        ))}
      </div>
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="邮件编辑方式">
          {[
            ["source", "HTML源码"],
            ["rich", "格式化编辑"],
            ["preview", "预览"],
          ].map(([key, label]) => (
            <button
              type="button"
              role="tab"
              aria-selected={mode === key}
              key={key}
              onClick={() => switchMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm("恢复示例模板？仅替换当前编辑内容，保存后生效。")) {
              change(structuredClone(defaults));
              setMode("source");
            }
          }}
        >
          恢复示例模板
        </button>
      </div>
      {mode !== "preview" && (
        <div className="mail-format-toolbar">
          {[
            ["加粗", () => wrap("strong")],
            ["斜体", () => wrap("em")],
            ["下划线", () => wrap("u")],
            ["标题", () => wrap("h2")],
            ["段落", () => wrap("p")],
            [
              "列表",
              () => insert((text) => "<ul><li>" + text + "</li></ul>", true),
            ],
            ["居中", () => wrap("p", "text-align:center")],
            [
              kind === "verification" ? "验证按钮" : "验证码",
              () =>
                kind === "verification"
                  ? insert(
                      () =>
                        '<a href="{{verification_url}}" style="display:inline-block;background-color:#245fd1;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none">确认验证邮箱</a>',
                    )
                  : insert(() => "<strong>{{login_code}}</strong>"),
            ],
          ].map(([label, action]) => (
            <button
              key={label}
              type="button"
              aria-label={"邮件" + label}
              onMouseDown={(e) => {
                e.preventDefault();
                if (mode === "rich") remember();
              }}
              onClick={action}
            >
              {label}
            </button>
          ))}
          <select
            aria-label="邮件字号"
            value=""
            onMouseDown={() => {
              if (mode === "rich") remember();
            }}
            onChange={(e) => wrap("span", "font-size:" + e.target.value)}
          >
            <option value="">字号</option>
            {[14, 16, 20, 24].map((n) => (
              <option key={n} value={n + "px"}>
                {n}px
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorBox>{error}</ErrorBox>
      {mode === "source" ? (
        <label className="field">
          <span>HTML正文</span>
          <textarea
            ref={source}
            aria-label="HTML正文"
            className="editor mail-source"
            value={value.html}
            maxLength={100000}
            spellCheck={false}
            onChange={(e) => change({ ...value, html: e.target.value })}
          />
        </label>
      ) : mode === "rich" ? (
        <div
          ref={editor}
          aria-label="邮件格式化正文"
          role="textbox"
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          className="mail-rich"
          dangerouslySetInnerHTML={{ __html: safeSource }}
          onMouseUp={remember}
          onKeyUp={remember}
          onInput={(e) => change({ ...value, html: e.currentTarget.innerHTML })}
          onPaste={paste}
          onDrop={(e) => e.preventDefault()}
        />
      ) : (
        <iframe
          title="邮件模板预览"
          className="mail-preview"
          sandbox=""
          srcDoc={
            '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src-attr &apos;unsafe-inline&apos;; img-src data:; base-uri &apos;none&apos;; form-action &apos;none&apos;"></head><body>' +
            (preview?.html || "") +
            "</body></html>"
          }
        />
      )}
      <p className="muted">
        支持邮件常用HTML和行内样式；预览不执行脚本、不加载外部图片。选中文字后可应用格式。保存时必须保留
        {kind === "verification" ? "验证链接" : "验证码变量"}。
      </p>
      <details>
        <summary>纯文本正文（备用，可留空自动生成）</summary>
        <textarea
          aria-label="纯文本邮件正文"
          className="editor mail-text"
          value={value.text}
          maxLength={20000}
          onChange={(e) => change({ ...value, text: e.target.value })}
        />
      </details>
    </section>
  );
}
