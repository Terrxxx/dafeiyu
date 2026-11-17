// The model form is the main content. Its save action uses the existing secondary button and field spacing.
import React, { useState } from "react";
import { api, Card, Field, Form } from "./shared.jsx";

const kinds = [
  ["image", "图片生成"],
  ["speech", "文字转语音"],
  ["music", "音乐生成"],
  ["effect", "音效生成"],
];

function MediaModelForm({ kind, settings, notify, reload }) {
  const [enabled, setEnabled] = useState(settings.enabled ?? false);
  const [protocol, setProtocol] = useState(settings.protocol || "openai");
  const [source, setSource] = useState(settings.source || "chat");
  const [key, setKey] = useState("");
  const needsRoute = protocol === "openai" && ["music", "effect"].includes(kind);
  const independent = source === "custom";
  const customEndpoint = protocol === "custom";

  return (
    <Form submit={async (values) => {
      await api("/account/media-model", { ...values, kind, enabled });
      setKey("");
      notify("媒体模型已保存，重启大肥鱼后生效");
      await reload();
    }}>
      <label className="switch-row">
        <strong>启用此模型</strong>
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      </label>
      {enabled && <>
        <div className="form-grid media-model-fields">
          <label className="field">
            <span>API 协议</span>
            <select name="protocol" value={protocol} onChange={(event) => setProtocol(event.target.value)}>
              <option value="openai">OpenAI 兼容</option>
              <option value="custom">自定义端点</option>
              {kind !== "image" && <option value="elevenlabs">ElevenLabs</option>}
            </select>
            {needsRoute && <small>音乐和音效需要支持同步生成的兼容网关，也可选择 ElevenLabs。</small>}
          </label>
          <label className="field">
            <span>API 来源</span>
            <select name="source" value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="chat">{customEndpoint ? "复用聊天模型的 API Key" : "复用聊天模型的 API URL 和 API Key"}</option>
              <option value="custom">{customEndpoint ? "使用独立 API Key" : "使用独立 API URL 和 API Key"}</option>
            </select>
            {!independent && <small>{customEndpoint ? "端点须和聊天 API 同源。" : "聊天供应商需同时提供这项媒体接口。"}</small>}
          </label>
          {customEndpoint && <Field label="完整媒体端点" name="endpoint" type="url" maxLength={1024} required
            defaultValue={settings.endpoint} placeholder="https://example.com/api/speech"
            hint="填写完整 HTTPS 请求地址。使用现有的 OpenAI 兼容请求格式。" />}
          {independent && <>
            {!customEndpoint && <Field label="媒体 API URL" name="baseUrl" type="url" maxLength={1024} required
              defaultValue={settings.baseUrl} placeholder={protocol === "elevenlabs" ? "https://api.elevenlabs.io/v1" : "https://api.openai.com/v1"} />}
            <Field label="媒体 API Key" name="apiKey" type="password" maxLength={300} autoComplete="off"
              required={!settings.keySet} value={key} onChange={(event) => setKey(event.target.value)}
              hint={settings.keySet ? "留空保留已保存的密钥。更换供应商时请填写新密钥。" : undefined} />
          </>}
          <Field label="媒体模型 ID" name="model" required maxLength={128} defaultValue={settings.model} />
          {kind === "speech" && <Field label="音色名称或 ID" name="voice" required maxLength={128} defaultValue={settings.voice} />}
          {needsRoute && <Field label="生成接口路径" name="route" required maxLength={150}
            defaultValue={settings.route} placeholder={kind === "music" ? "/audio/music" : "/audio/sound-effects"} />}
        </div>
        {kind === "speech" && protocol !== "elevenlabs" && <label className="field">
          <span>语音风格提示词</span>
          <textarea name="instructions" rows={3} maxLength={4096} defaultValue={settings.instructions || ""}
            placeholder="例如：清亮、软萌的普通话女声，像给朋友发语音" />
          <small>需要供应商和模型支持语音风格指令。留空使用音色的默认风格。</small>
        </label>}
        {kind !== "image" && <p className="muted">音频通过 QQ 语音发送，需开启「允许发送语音」及语音组件。</p>}
      </>}
      <button type="submit">保存媒体模型</button>
    </Form>
  );
}

export default function MediaModelSettings({ models = {}, notify, reload }) {
  const [kind, setKind] = useState("image");
  return (
    <Card title="媒体生成模型" subtitle="分别配置图片、语音、音乐与音效。保存后重启大肥鱼。">
      <label className="field">
        <span>模型用途</span>
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          {kinds.map(([id, label]) => <option key={id} value={id}>
            {label} · {models[id]?.enabled ? "已启用" : "未启用"}
          </option>)}
        </select>
      </label>
      <MediaModelForm key={kind} kind={kind} settings={models[kind] || {}} notify={notify} reload={reload} />
    </Card>
  );
}
