# 大肥鱼 · QQ × B站自主社交伙伴

这是一个在本机运行的 Node.js 项目：DeepSeek 负责决定如何聊天和分享，NapCat / OneBot 11 负责 QQ 收发，B站网页接口负责热门视频、字幕、@通知和评论。当前通过 DeepSeek Harness SDK 驱动模型与工具循环，QQ/B站接口和定时触发由本项目适配；本项目不是 DeepSeek 官方产品。

## 已实现

- QQ：普通账号经 NapCat 接入，允许范围内的群无需 @；私聊和群聊均先合并连续消息，再由 AI 判断是否接话。不同私聊/群的历史隔离、重启保留。
- B站：每 90 秒检查 @ 通知，每 30 分钟读取热门视频，不限定主题。
- 自主决策：模型可查询 QQ 好友/群、读取视频、自主选择是否发送 QQ 分享或发表评论。分享对象不是预先写死的。
- 扫码登录：B站手机 App 扫码，Cookie 保存在本机 `data/bilibili-auth.json`。
- 可靠性：串行任务队列、QQ重连、回复去重、持久化额度、发送状态不明时不自动重发、单实例锁、评论楼层核验。
- 本地记录：`data/actions.jsonl` 是动作审计，`data/state.json` 保存记忆和去重，`reports/` 保存每轮浏览报告。
- 图片理解：接收 QQ 图片和纯图片消息，使用当前模型描述截图、表情和梗图；最多 3 张，每张 8MB，失败时明确说明。
- 真实互动：支持 QQ 原生引用回复、@发送者、查询群成员并@指定成员，不通过拼接CQ字符串伪造消息。
- 自主任务：AI 可创建、查看和取消会话内的未来任务，到期后自动执行；重启保留任务记录。

## 图片、主动分享与自主任务

当前配置的官方 `deepseek-flash` 已用生成的红色测试图片完成真实视觉请求验证，能够识别红色色块。无需另配视觉模型。QQ图片先从QQ图片服务下载，送给当前模型识别，文字观察结果进入对话；图片本体不会写入长期记忆。本版不读取本地任意路径；失效链接会尝试通过 NapCat `get_image` 刷新。GIF的理解能力取决于模型，不保证完整理解动画。

AI 可用 `qq_reply_current` 自主选择引用或@发送者，用 `qq_group_members` 查询目标群成员，再通过 `qq_send_message` 的 `atUserIds` 参数真正@成员（最多3人，不支持@全体）。工具已回复当前消息时，程序不会把最终文本再发送一次。

AI 继续每30分钟主动浏览热门，发现实际内容中有趣的地方后，自主决定是否把链接和短评分享给合适的好友或群。对同一接收对象分享相同BV视频时去重，即使文案不同也不重复。B站视频仍主要通过首分P字幕理解，新增QQ识图不等于已经支持视频画面分析。

自主任务通过 `task_create({prompt, delayMinutes})` 安排，可通过 `task_list` 查看和 `task_cancel({id})` 取消。每项为一次性任务，1分钟至7天后执行，最多12项待办，每小时最多启动6项。程序每30秒检查一次，到期后还可能等待任务队列；程序停止时不会执行，重新启动后补执行到期的待办。若进程在执行途中中断，该任务标为 `uncertain`，不自动重放可能已经发送的消息。

任务保留原会话范围，执行时可调用模型现有工具，包括继续浏览和选择分享目标；结果写入 `reports/task-任务ID.md`。只有发送工具成功才代表已通知用户，写报告不等于发了消息。任务创建和完成状态记录在 `data/actions.jsonl`。

自然聊天规则在 `persona.md`：短句接话、适度玩笑、根据上下文决定参与，不每次列清单或自我介绍，也不虚构真人身份和现实经历。

## 当前验证状态

35 项单元与模拟测试通过；B站热门接口和当前模型图片识别已完成真实请求验证。新增历史上报、点赞和空间发布尚未完成线上验收。B站接口属于社区整理的网页接口，平台变更可能需要调整；不把本地测试通过等同于线上已打通。

## 首次启动

### 1. 填写模型配置

首次克隆先复制 `.env.example` 为 `.env`。用文本编辑器打开它，填写：

```dotenv
DEEPSEEK_API_KEY=你的API密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
NAPCAT_WS_URL=ws://127.0.0.1:3001
NAPCAT_TOKEN=在NapCat中设置的相同Token
```

模型名可按自己账号可用模型修改。不要把密钥或 Cookie 发到聊天里。Node.js 24 或更新版本即可；已有环境无需 Python。

### 2. 配置 NapCat

使用 [NapCat 官方安装文档](https://napneko.github.io/guide/boot/Shell) 安装 Windows 版，登录准备作为“大肥鱼”的 QQ 账号。

在 NapCat WebUI 的网络配置中新增 **WebSocket 服务端（正向 WS）**：

| 设置 | 值 |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `3001` |
| Token | 与 `.env` 中 `NAPCAT_TOKEN` 一致 |
| 消息格式 | `array`（消息段数组） |
| 启用 | 是 |

本项目主动连接此服务端。NapCat 的 WebUI 管理端口不是 OneBot 端口。运行中断开 QQ 后会每 10 秒尝试重连。项目不自动安装、修改或卸载你现有的 QQ 客户端。

### 3. 登录 B站

在项目目录运行：

```powershell
npm.cmd run login:bili
```

或双击 `login-bilibili.cmd`，使用 B站手机 App 扫终端二维码。也可打开临时图片 `data/bilibili-login.png` 扫描；登录结束后图片会删除。

二维码登录失败时，可在本机 `.env` 的 `BILIBILI_COOKIE` 填入自己的完整浏览器 Cookie（包含 `SESSDATA` 和 `bili_jct`）。此变量优先于扫码文件，重新扫码前请清空旧变量。Cookie 到期后重新登录。

### 4. 检查并运行

```powershell
npm.cmd run doctor
npm.cmd run doctor -- --online
npm.cmd start
```

也可以双击 `start.cmd`。`doctor` 只检查本地必需配置；`--online` 还会读取 B站登录状态和 NapCat 登录信息，不发测试消息。

首次启动成功后会建立 @ 通知基线，忽略历史通知。启动后约 30 秒自动开始第一轮自主浏览，**可能真实发送 QQ 消息和 B站评论**。此行为对应你要求的自主分享。后台必须保持运行；关闭终端即停止。Ctrl+C 会等当前任务结束后退出。

只运行一轮自主浏览：`npm.cmd run once`。它同样可能真实发送消息。

## 设置和人设

首次运行从 `config.example.json` 创建本地 `config.json`，示例 QQ 允许列表为空，需要填写范围或 `["*"]`。本机已有配置保持不变。修改 `config.json` 后重启；`persona.md` 控制“大肥鱼”的性格与判断方式。

| 配置 | 默认值 / 含义 |
| --- | --- |
| `qq.allowUsers` / `qq.allowGroups` | 示例为空；`["*"]` 允许所有好友/群，字符串 ID 数组可限定 |
| `qq.requireMentionInGroup` | 当前为 `false`，无需 @，每条群文本由 AI 判断是否回复；改为 `true` 时只判断 @ 消息 |
| `qq.cooldownSeconds` | 同会话两次开始生成之间至少 15 秒；新消息排队等待，不会因为冷却被丢弃；可改为 0 |
| `bilibili.allowMentionUsers` | `["*"]`，任何人的视频评论 @ 都可回复 |
| `bilibili.pollSeconds` | 90 秒 |
| `bilibili.browseMinutes` | 30 分钟 |
| `bilibili.maxVideosPerRound` | 每轮最多读取 3 个视频 |
| `agent.maxToolRounds` | 一次任务最多 6 轮模型决策 |
| `agent.maxModelCallsPerHour` | 示例为每小时 60 次；设为 `0` 不限制模型请求次数，平台自身额度仍适用 |
| `agent.maxOutgoingPerHour` | 每小时最多 20 次发送尝试，包括 QQ 和 B站 |
| `agent.maxBiliCommentsPerHour` | 每小时最多 3 次 B站评论尝试 |

禁用某个平台：将对应 `enabled` 改为 `false`。所有额度跨重启保留，是本机程序限额，不是平台承诺的安全额度。自主分享可以选择任何已查询到、符合允许列表的 QQ 好友/群；不会自动加好友、加群。一次列表最多向模型展示 150 个目标。

私聊和群聊参与判断单独调用模型，只返回是否回复，不执行工具。决定保持安静时不会发送消息，也不会占用发送额度，但消息仍进入对应会话的上下文。决定回复后再生成内容，沿用冷却、队列及发送限额。每次判断也计入 `maxModelCallsPerHour`，达到额度后会在终端报告；模型判断失败时不自动发言。

## 等待消息与主动社交

每个会话等待最后一条消息后安静 8 秒再合并，从首条开始最多等待 25 秒；之后仍可能等待队列和冷却。通过 `qq.mergeSeconds` / `qq.maxWaitSeconds` 调整。合并保留说话者；AI 可以选择不回复。关闭进程会清空尚未提交的等待消息。

`social.enabled` 开启自主社交，每 `social.intervalMinutes`（默认 10 分钟）思考一次，启动后 60 秒触发首轮，此后按间隔循环。AI 可主动在允许的群发言、给好友分享，或保持安静；此轮不依赖 B站登录成功。报告保存在 `reports/social-*.md`，程序必须保持运行。

`qzone_publish` 使用 NapCat 的 `send_qzone_msg` 发布文字或包含链接的 QQ 空间说说，需要支持该接口的 NapCat。`social.qzoneEnabled` 可关闭，`social.qzoneVisibility` 默认 4（好友），也支持 1（所有人）或 64（仅自己）。每小时最多尝试 1 条，并计入总发送额度；同文去重，未获得回执不会自动重发。

每次实际读取视频详情时上报 B站历史，工具返回 `historyRecorded`，失败会附原因。热门列表查询不写历史。上报进度为 0，代表浏览记录，不表示已经播放或看完视频。AI 只能给本轮读过的视频点赞，每小时最多尝试 10 次，同一视频去重；不会自动取消点赞。

## 模型可调用的接口

| 工具 | 功能 |
| --- | --- |
| `bili_popular()` | 获取 20 条热门视频候选 |
| `bili_read_video({bvid})` | 获取标题、简介、首分P字幕，并上报历史 |
| `bili_like_video({bvid})` | 给本轮读过的视频点赞 |
| `qzone_publish({text})` | 发布 QQ 空间文字动态 |
| `qq_list_targets()` | 查询好友和群作为分享候选 |
| `qq_send_message({kind,target,text,atUserIds?})` | 向模型选中的目标发送消息，可@目标群成员 |
| `qq_group_members({groupId})` | 查看已查询群的成员，选择@对象 |
| `qq_reply_current({text,mentionSender?,quote?})` | 当前会话回复，支持原生引用和@ |
| `task_create({prompt,delayMinutes})` | 给自己安排一次未来任务 |
| `task_list()` / `task_cancel({id})` | 查看/取消当前会话的任务 |
| `bili_post_comment({bvid,text})` | 在本轮读过的视频下公开发表评论 |

工具定义与权限检查见 `src/tools.js`。模型没有执行系统命令、读取任意本地文件或修改配置的工具。QQ直接回复和B站@回复由程序投递到原会话/楼层。B站主动评论分享看法；QQ分享可附视频链接。本版没有“发B站动态”和“B站私信”工具。

## 已知边界

- 视频理解使用首分P字幕，最长 16000 字符；没有视觉抽帧或语音转写。无字幕/获取失败时，只提供标题简介并明确注明。
- B站只处理视频评论区 @，不处理动态、弹幕或私信 @。只读取最近最多 5 页通知，每个评论楼层核验最多 5 页。通知缺失定位字段或无法核验时跳过并审计，不猜楼层。
- “@我的”网页接口字段需真实账号联调；目前按通知 URI、原生链接与 `item.id` 解析，平台字段变更时应调整 `parseMention`。
- QQ理解文本和图片消息段，暂不读语音或还原收到的引用内容；需 NapCat 配置数组格式。
- 历史是每个会话最近 64 条记录，不是无限长期记忆。私聊/群/视频讨论互相隔离；自主浏览使用独立会话。
- `pending` / `uncertain` 代表上次发送未确认，自动化不会再次发送，需先在平台核实。失败的 @ 最多尝试 3 次。
- 数据与凭据保存在本地，聊天和字幕会发送给你配置的模型服务。分享/回复是账号真实行为，第三方桥接和网页接口可能遇到平台风控。
- 不支持自动开机启动、验证码绕过和登录续期；无登录时不会假装已接入。

## 开发与验证

Git 仅保存源码、测试和配置示例。`.env`、`config.json`、`data/`、`reports/`、NapCat 安装目录与压缩包、日志和数据库均忽略，不要强制添加。克隆后需单独配置凭据与登录。

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
```

测试不使用真实账号，不发送外部消息，覆盖消息筛选、持久化去重、并发队列、会话隔离、限额、WBI签名、评论楼层、验证码失败与模型工具调用链路。

真实验收建议：先 `doctor -- --online`；从另一个QQ私聊/群@测试；程序基线建立后在B站视频评论@登录账号；最后查看一次自主浏览的报告和平台真实发送结果。

## 接口依据

- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)
- [NapCat 接入说明](https://napneko.github.io/use/integration)
- [OneBot 11](https://github.com/botuniverse/onebot-11)
- [B站评论接口](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/comment/action.md)
- [B站通知与字段](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/message/msg.md)
- [B站WBI签名](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/misc/sign/wbi.md)
- [B站二维码登录](https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/login/login_action/QR.md)

### QQ 分条消息

模型使用空行划分消息气泡；长段落按句子拆分，通常每条不超过 240 个字符，链接保持完整。各条间隔约 0.9 秒，引用和 @ 只附在第一条。取消原有 1500 字截断，不再悄悄丢弃长回复尾部。发送前按条数预留总额度；中途失败立即停止并标记状态不明，不自动重发整段。

后台浏览与社交由定时器驱动，不需要收到用户消息。每轮结束后再计时，错误会记录且下一轮继续；启动时输出首轮时间与间隔，后台任务可能等待当前消息处理结束。自主社交仍由 AI 决定对象和内容，也可保持安静。

### 会话上下文

`agent.historyMessages` 当前为 64，控制每个会话保留的最近记录数；`agent.contextMaxChars` 当前为 24000，控制单次请求携带的历史字符数，优先保留较新的内容。这不是模型总 token 上限，当前消息、系统提示和工具结果另外占用上下文。

QQ 私聊、群聊分别保存；未回复的消息和图片描述也能进入历史。成功发送的主动消息会写回接收者会话，工具回复记录实际正文，不记录内部结束语。发送失败不会当成已发送；分条中途失败可能已有部分送达，此时不把整段记为成功。历史保存于被 Git 忽略的 `data/state.json`，重启保留，旧数据兼容；过去已被裁掉的记录无法恢复。模型可看到当前 UTC 时间与最近记录时间。

### 短句、选择性分享与收藏表情

人设默认日常回复 2～10 个字，必要解答可以展开，不按十字强行截断。自主浏览与转发分开判断，整轮不分享是正常结果；是否转发仍由模型决定，不是固定配额。

`qq_list_stickers` 通过 NapCat `fetch_custom_face` 读取账号最多 12 个收藏表情候选，`qq_inspect_sticker` 使用当前视觉模型描述图片，`qq_send_sticker` 只发送本轮看懂的图片，一轮最多一张，计入发送额度。需要先在该 QQ 账号收藏表情；没有合适表情就短句回复或保持安静。支持受信 QQ 图片域名，无法下载或识别的表情不会盲发。发送到当前会话后不再自动追加模型结束语，表情描述会记入对应上下文。新增链路通过模拟测试，尚未做真实账号表情发送验收。

### Harness 接管模式

`runtime: "harness"` 为当前默认值。`npm start` / `start.cmd` 自动启动专用 Harness SDK 子进程，使用现有 `.env` 的模型配置，不需要手动打开 Web UI。QQ 判断回复、图片理解、生成回复、自主浏览和到期任务都调用 Harness；平台收发、定时触发、会话允许范围和发送去重继续由本项目负责。`runtime: "direct"` 可切回原引擎，重启生效。

SDK 使用 `harness-runtime/home/profiles/dafeiyu`，模型密钥只从父进程读取，不写入该配置。只注册本项目的社交工具，没有启用通用终端或文件操作工具。后台任务仍是原来的 10 分钟社交／30 分钟浏览，未另建一套重复定时任务。

现有 `data/state.json` 的有界会话历史继续注入每次 Harness 任务，不需要清空或复制私人聊天。每轮创建独立 SDK 会话以隔离工具状态，执行轨迹写入 `harness-runtime/home/sessions`；`data/actions.jsonl` 中的 `harness-run` 保存对应会话 ID。运行时每 40 次任务回收一次 SDK 进程，轨迹保留。原有额度按真实模型请求计数，判断与识图禁止社交工具调用。

验证包括真实 Harness 工具回调（模拟模型和平台）、真实模型文字请求及生成色块识图；没有为了验收而发布测试评论或 QQ 消息。
# 新增：公开数据与渐进偏好

可通过 `bili_search` 搜索视频，`bili_video_stats` 查询播放、点赞、收藏等快照，`bili_related` 读取相关推荐，`bili_comments` 获取最多 20 条去重评论样本。搜索和统计不会记入观看历史，也不等于看过视频；`bili_read_video` 保留原有资料阅读与历史上报逻辑。

后台自主浏览、社交还可用 `bili_my_history` 查看最近 20 条账号历史，`bili_my_following` 分页读取关注，`bili_my_folders` 列出最多 100 个自己的收藏夹，`bili_my_favorites` 分页读取其中内容（每页 20 条，页码 1–100）。每次验证登录身份，收藏内容限定本人收藏夹。QQ消息和其他scope无法调用这些接口；提示词要求不转述私人来源，只用公开资料独立判断分享价值。这些接口只读，不修改关注、收藏或历史。数据会交给当前配置的模型，Harness本地运行记录可能保留工具结果，相关目录已忽略提交。

兴趣与表达偏好保存在已忽略的本地 `data` 状态中。自主浏览结束后，对本轮实际读取、尚未评价的视频复盘（最多 3 个）；也可主动使用 `self_rate_video`。同一分类至少积累 3 个样本后才注入偏好，每个视频不重复计分。偏好不自动触发点赞或转发。

每个会话累计 8 批合并消息后可复盘表达习惯，两次复盘至少相隔 30 分钟。只接受用户原话中的明确反馈，每次最多调整两个维度，每个维度最多变化 0.05；不同会话独立保存。没有证据就不调整。复盘会消耗额外模型请求，失败不会阻断已完成的聊天。这是持久化偏好记忆，不是训练模型权重，也不保证每次输出都符合风格。
