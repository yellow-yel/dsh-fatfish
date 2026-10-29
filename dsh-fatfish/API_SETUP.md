# 免费 API 配置指南

## 推荐: 智谱 AI (GLM-4-Flash) - 完全免费

### 1. 注册账号
访问 https://open.bigmodel.cn/ 注册账号

### 2. 获取 API Key
- 登录后进入控制台
- 点击"API Keys" → "创建 API Key"
- 复制生成的 Key (格式: xxx.xxx.xxx)

### 3. 在 DSH 中配置
- 打开 DSH 设置 → 插件 → 大肥鱼
- 开启"启用独立 API"
- 选择"智谱 AI (推荐)"
- 粘贴 API Key
- 模型保持 `glm-4-flash`
- 保存

### 4. 测试
在 DSH 对话框输入:
```
/fatfish.chat 你好呀
```

大肥鱼应该回复你！

---

## 其他免费选项

### 阿里云通义千问
- 注册: https://dashscope.console.aliyun.com/
- 免费额度: 每月有一定免费调用量
- 模型: `qwen-turbo` (最快) / `qwen-plus` (更强)

### DeepSeek
- 注册: https://platform.deepseek.com/
- 免费额度: 注册送一定额度
- 模型: `deepseek-chat`

---

## 不启用独立 API?

如果你不想配置独立 API，插件仍然有效！

DSH 本身已经集成了 LLM (DeepSeek 等)，插件会：
1. 给 DSH 的 agent 注入大肥鱼人格
2. agent 用 DSH 配置的 LLM 回复
3. 回复风格会符合大肥鱼的人设

**区别：**
- 不启用独立 API: 使用 DSH 的 LLM 配置 (可能需要 DeepSeek 付费账号)
- 启用独立 API: 使用你配置的免费 API (完全不花钱)

---

## 常见问题

### Q: 智谱 API 真的完全免费吗？
A: GLM-4-Flash 模型目前完全免费，没有限制。其他模型可能有免费额度。

### Q: API Key 安全吗？
A: Key 只写进 DSH 的本地插件配置，不上传、不进日志。插件不会把 Key 回显给你，也不会发给除所选平台之外的地址。

### Q: 可以同时用多个 API 吗？
A: 可以切换，但同一时间只能用一个。在设置页切换提供商即可。

### Q: 回复太慢怎么办？
A: 尝试切换更快的模型，如 `glm-4-flash` 或 `qwen-turbo`。

### Q: 报错了怎么办？
A: 检查：
1. API Key 是否正确
2. 网络连接是否正常
3. 查看 DSH 控制台错误信息
