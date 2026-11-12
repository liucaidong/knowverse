# 工具调用闭环与 MCP 协议边界

> 本章依据 OpenAI Function Calling 文档与 MCP 2026-07-28 规范整理。工具调用是应用控制流的一部分，不是模型在文本里写出函数名就已经完成执行。

## 1. 模型提出请求，应用负责执行

典型工具调用至少有五个阶段：

1. 应用把可用工具及其 JSON Schema 交给模型。
2. 模型返回工具调用请求，包含名称、参数和调用关联标识。
3. 应用解析参数，执行 Schema 校验、身份验证、资源授权和业务策略检查。
4. 检查通过后，应用才调用真实工具，并把结果与原调用标识关联。
5. 应用把工具结果交回模型；模型可以继续请求工具，也可以形成最终回答。

**关键边界：** 模型只能提出请求。它不能通过参数声称“我是管理员”，也不能通过自然语言证明某个账户归当前用户所有。授权必须在可信的应用服务端完成。

## 2. Schema 约束不等于业务授权

Function Calling 使用 JSON Schema 描述工具参数。严格模式可以提高结构遵循性，但它只回答“参数是否符合约定的形状”，不回答“当前用户是否有权执行这项操作”。服务端仍然必须从已验证的会话中取得用户身份，再检查目标资源是否属于该用户。写操作还应增加幂等键、额度或次数限制、审计记录和必要的二次确认。

```js
const tool = {
  type: "function",
  name: "get_account_balance",
  strict: true,
  parameters: {
    type: "object",
    properties: { account_id: { type: "string" } },
    required: ["account_id"],
    additionalProperties: false
  }
};
```

## 3. MCP 的 Host、Client 与 Server

- **Host：** 发起连接并承载用户体验的 LLM 应用。
- **Client：** Host 内负责与 MCP Server 通信的协议连接器。
- **Server：** 向 Client 提供上下文和能力的服务。

| 能力 | 作用 | 不应误解为 |
|---|---|---|
| Resources | 提供可读取的上下文或数据 | 已授权的写操作 |
| Prompts | 提供可复用的提示模板或工作流 | 系统级可信指令 |
| Tools | 提供模型可请求执行的函数能力 | 模型可以绕过 Host 直接执行 |

MCP 是连接协议，不是权限系统的替代品。Host 仍需要向用户说明数据访问和工具操作，并在应用边界执行授权。

## 4. 2026-07-28 规范的状态模型

MCP 2026-07-28 规范采用无状态、自包含请求和逐请求能力声明。不要把旧版 `initialize` 握手、长生命周期 Session ID 或连接级能力协商当作所有实现都必须具备的永久机制。实现时应明确客户端和服务端所支持的协议版本，并按对应规范处理发现、能力和请求元数据。

## 5. RAG、MCP 与 Agent 不互相替代

- RAG 解决“哪些证据进入上下文”。
- MCP 解决“应用如何标准化连接外部上下文与工具”。
- Agent 解决“在目标约束下，如何选择步骤、工具并根据结果继续”。

三者可以组合，但任何组合都不能省略应用侧的权限、数据校验和副作用控制。

## 自测

模型返回 `function_call` 后，应用是否可以直接把它当作工具结果展示？不能。应用必须先验证参数、验证当前身份与资源权限，再执行真实工具，并把结果绑定到原始 `call_id`。

## 参考来源

- [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Model Context Protocol Specification · 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Anthropic · Building effective agents](https://www.anthropic.com/research/building-effective-agents)
