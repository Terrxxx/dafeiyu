import loginDefaults from "../src/login-mail-template-defaults.json" with { type: "json" };
import registrationDefaults from "../src/registration-mail-template-defaults.json" with { type: "json" };
import passwordDefaults from "../src/password-mail-template-defaults.json" with { type: "json" };
import { load } from "cheerio";
import defaults from "../src/mail-template-defaults.json" with { type: "json" };
export const defaultLoginMailTemplate = loginDefaults;
export const defaultRegistrationMailTemplate = registrationDefaults;
export const defaultPasswordMailTemplate = passwordDefaults;
export const defaultMailTemplate = defaults;
const keys = new Set([
  "site_name",
  "username",
  "action_label",
  "purpose",
  "expires_hours",
  "verification_url",
  "login_code",
  "expires_minutes",
]);
const tags = new Set(
  "div p span strong b em i u s br hr h1 h2 h3 ul ol li blockquote a table tbody thead tfoot tr td th img".split(
    " ",
  ),
);
const styles = new Set(
  "background-color color font-family font-size font-weight font-style text-align text-decoration line-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-color border-width border-style border-radius border-collapse width max-width min-width height vertical-align display".split(
    " ",
  ),
);
export const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
function linkAllowed(value) {
  if (value === "{{verification_url}}") return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !/[\x00-\x20]/.test(value)
    );
  } catch {
    return false;
  }
}
export function sanitizeMailHtml(source) {
  const $ = load(source, {}, false);
  $(
    "script,style,iframe,object,embed,svg,math,form,input,button,textarea,select,link,meta,base,video,audio,source,frame,frameset",
  ).remove();
  $("*").each((_, el) => {
    const node = $(el),
      tag = el.tagName?.toLowerCase();
    if (!tags.has(tag)) {
      node.replaceWith(node.contents());
      return;
    }
    for (const name of Object.keys(el.attribs || {})) {
      const value = node.attr(name) || "";
      if (name === "style") {
        const cleaned = value
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split(";")
          .flatMap((part) => {
            const at = part.indexOf(":");
            if (at < 0) return [];
            const prop = part.slice(0, at).trim().toLowerCase(),
              val = part.slice(at + 1).trim();
            return styles.has(prop) &&
              val.length < 300 &&
              !/(url\s*\(|expression|@import|behavior|binding|javascript|[<>\\])/i.test(
                val,
              )
              ? [prop + ":" + val]
              : [];
          })
          .join(";");
        cleaned ? node.attr(name, cleaned) : node.removeAttr(name);
      } else if (tag === "a" && name === "href") {
        if (!linkAllowed(value)) node.removeAttr(name);
      } else if (tag === "img" && name === "src") {
        if (
          !linkAllowed(value) &&
          !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
            value,
          )
        )
          node.removeAttr(name);
      } else if (
        [
          "colspan",
          "rowspan",
          "width",
          "height",
          "cellpadding",
          "cellspacing",
          "border",
        ].includes(name) &&
        /^\d{1,4}%?$/.test(value)
      ) {
      } else if (["alt", "title"].includes(name)) {
        node.attr(name, value.slice(0, 300));
      } else node.removeAttr(name);
    }
  });
  return $.html();
}
export function normalizeMailTemplate(
  value = defaults,
  { requireLink = true, kind = "verification" } = {},
) {
  if (!["verification", "login", "registration", "password"].includes(kind))
    throw Error("邮件模板类型无效");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("邮件模板格式无效");
  const t = {
    ...(kind === "login"
      ? loginDefaults
      : kind === "registration"
        ? registrationDefaults
        : kind === "password"
          ? passwordDefaults
          : defaults),
    ...value,
  };
  if (
    typeof t.subject !== "string" ||
    !t.subject.trim() ||
    t.subject.length > 200 ||
    /[\r\n\0]/.test(t.subject)
  )
    throw Error("邮件主题须为1至200字，不能换行");
  if (
    typeof t.html !== "string" ||
    t.html.length > 100000 ||
    typeof t.text !== "string" ||
    t.text.length > 20000
  )
    throw Error("HTML正文最多100000字符，纯文本最多20000字符");
  for (const source of [t.subject, t.html, t.text])
    for (const m of source.matchAll(/{{\s*([^{}]+?)\s*}}/g))
      if (!keys.has(m[1])) throw Error("未知邮件变量：" + m[1]);
  t.html = sanitizeMailHtml(t.html);
  if (requireLink && ["login", "registration", "password"].includes(kind)) {
    if (
      !/{{\s*login_code\s*}}/.test(t.html) ||
      (t.text && !/{{\s*login_code\s*}}/.test(t.text))
    )
      throw Error("验证码正文须保留{{login_code}}");
  }
  if (requireLink && kind === "verification") {
    const $ = load(t.html, {}, false);
    if (
      !$("a")
        .toArray()
        .some((a) => $(a).attr("href") === "{{verification_url}}")
    )
      throw Error('HTML正文须保留href="{{verification_url}}"的验证链接');
    if (t.text && !/{{\s*verification_url\s*}}/.test(t.text))
      throw Error("纯文本正文须保留{{verification_url}}");
  }
  return t;
}
export function renderMailTemplate(
  template,
  variables,
  { requireLink = true, kind = "verification" } = {},
) {
  const t = normalizeMailTemplate(template, { requireLink, kind });
  const fill = (source, html = false) =>
    source.replace(/{{\s*([a-z_]+)\s*}}/g, (_, key) =>
      html ? escapeHtml(variables[key] ?? "") : String(variables[key] ?? ""),
    );
  const html = fill(t.html, true);
  let text = fill(t.text);
  if (!text) {
    const $ = load(html, {}, false);
    $("a").each((_, a) =>
      $(a).replaceWith($(a).text() + " (" + ($(a).attr("href") || "") + ")"),
    );
    $("br").replaceWith("\n");
    $("p,div,h1,h2,h3,li,tr").append("\n");
    text = $.text()
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return { subject: fill(t.subject), html, text, editorHtml: t.html };
}
export function mailVariables(settings, name, url, purpose = "bind") {
  return {
    site_name: settings.smtp.senderName || "大肥鱼",
    username: name,
    verification_url: url,
    expires_hours: "24",
    action_label:
      purpose === "register"
        ? "激活账号"
        : purpose === "test"
          ? "发信测试"
          : "验证邮箱",
    purpose:
      purpose === "register"
        ? "请验证邮箱，完成大肥鱼账号激活。"
        : purpose === "test"
          ? "这是一封模板测试邮件，示例链接不能用于激活账号。"
          : "请验证邮箱，完成你的账户邮箱绑定。",
  };
}
