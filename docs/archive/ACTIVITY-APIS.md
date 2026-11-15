# 可调用业务接口与足迹

QQ：qq_get_profile 查看资料；qzone_read 查看空间；qzone_read_comments 查看内嵌评论；qzone_publish 发布空间；qzone_like_post 点赞；qzone_comment_post 评论；qzone_reply_comment 回复评论。执行后写入 qq-activity.jsonl，不记录QQ聊天内容。读请求失败记为failed，写入状态不明记uncertain。

B站自主社交/浏览：bili_my_fans 查看粉丝，bili_my_following 查看关注，另有历史与收藏读取。专用收件轮次：bili_my_notices 查看点赞/评论回复/@通知，bili_my_messages 查看已有私信会话，bili_read_messages 读取对应会话，bili_reply_message 回复已读取消息，bili_reply_notice 回复已核验的通知楼层。私密工具不会出现在QQ会话工具列表，不转述跨平台私信。所有业务动作独立记录在 bilibili-activity.jsonl；观看视频本身仍不新增足迹。

足迹与筛选共用 activity-catalog.json，未发生的行为同样列在筛选中；通知可进一步按点赞、评论回复和@筛选。展示读取数量、对应账号、评论正文及已有BV引用。终态也携带非敏感输入元数据，避免日志分页截断后无法筛选。

站点及用户开关、睡眠与额度限制依然生效。后台直接收件轮询和旧@轮询同样检查组件与配置开关。

本轮未添加新MCP组件，未扩展站点全局管理权限给AI。用户已确认仅接入QQ/B站业务接口，不新增余额、Token或组件状态自查询接口。

验证：225项测试，224通过，1跳过；44张隔离浏览器截图检查，无脚本错误或移动端溢出。所有模拟行为在系统临时目录测试，没有发真实评论或私信。
