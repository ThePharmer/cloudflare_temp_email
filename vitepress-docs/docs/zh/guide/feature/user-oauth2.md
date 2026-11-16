# OAuth2 第三方登录

> [!WARNING] 注意
> 第三方登录会自动使用用户邮箱注册账号(邮箱相同将视为同一账号), 除非关闭了该提供商的自动注册开关(见[仅限邀请登录](#仅限邀请登录))
>
> 此账号和注册的账号相同, 也可以通过忘记密码设置密码

## 在第三方平台注册 OAuth2

### GitHub

- 请先创建一个 OAuth App，然后获取 `Client ID` 和 `Client Secret`
- 默认 GitHub 模板使用 `https://api.github.com/user` 作为用户信息接口，并读取返回 JSON 的 `email` 字段。GitHub 账号如果隐藏公开邮箱，该字段会是 `null`，登录会返回 `[400]: 从 Oauth2 提供商获取用户邮箱失败`。
- 解决方式是在 GitHub 个人资料中设置公开邮箱，或改成能返回邮箱的接口/提供商；如果返回值不是标准邮箱，可以使用下方“邮箱格式转换”。

如果不想公开 GitHub 邮箱，可以改用 GitHub 邮箱列表接口：

| 字段 | 值 |
|------|----|
| User Info URL | `https://api.github.com/user/emails` |
| User Email Key | `$[?(@.primary==true)].email` |
| Scope | `user:email` |

GitHub 个人资料中选择了 `Public email` 时，可以继续使用默认的 `https://api.github.com/user` + `email` 配置；只把邮箱从 private 改成可见但没有选择公开邮箱时，`/user` 接口仍可能返回 `email: null`。

参考 [Creating an OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)

### Linux Do

- 在 [Linux Do Connect](https://connect.linux.do/) 创建应用获取 `Client ID` 和 `Client Secret`
- Linux Do 返回的是用户 ID 而非邮箱，需要启用邮箱格式转换功能

### Authentik

- [Authentik OAuth2 Provider](https://docs.goauthentik.io/docs/providers/oauth2/)

## Admin 后台配置 OAuth2

![oauth2](/feature/oauth2.png)

### 配置字段说明

| 字段 | 说明 |
|------|------|
| Name | OAuth2 提供商名称，显示在登录页面 |
| Client ID | OAuth2 应用 ID |
| Client Secret | OAuth2 应用密钥 |
| Authorization URL | OAuth2 授权端点 |
| Access Token URL | 获取 Access Token 的端点 |
| Access Token Params Format | Token 请求格式：`json` 或 `urlencoded` |
| User Info URL | 获取用户信息的端点 |
| User Email Key | 用户信息中邮箱字段的 key，支持 JSONPath (如 `$[0].email`) |
| Redirect URL | OAuth2 回调地址 |
| Scope | OAuth2 权限范围 |

`Redirect URL` 必须和第三方平台 OAuth App 中配置的回调地址完全一致。前端默认回调路径为：

```text
https://你的前端域名/user/oauth2/callback
```

如果你的站点使用语言前缀路由，也仍然建议在 OAuth 平台中配置无语言前缀的回调地址，避免不同语言路径导致回调不一致。

### 邮箱格式转换

当 OAuth2 返回的不是标准邮箱格式时（如返回用户 ID），可以启用邮箱格式转换功能。

| 字段 | 说明 |
|------|------|
| Enable Email Format | 启用邮箱格式转换 |
| Email Regex Pattern | 正则表达式，用于匹配原始值，使用捕获组 `()` |
| Replace Template | 替换模板，使用 `$1`、`$2` 等引用捕获组 |

**示例：**

| 场景 | 原始值 | 正则表达式 | 替换模板 | 结果 |
|------|--------|-----------|----------|------|
| ID 转邮箱 | `12345` | `^(.+)$` | `linux_do_$1@oauth.linux.do` | `linux_do_12345@oauth.linux.do` |
| 换域名 | `john@old.com` | `^(.+)@old\.com$` | `$1@new.com` | `john@new.com` |
| 提取用户名 | `john@corp.com` | `^(.+)@.*$` | `$1@mymail.com` | `john@mymail.com` |

### 邮件地址白名单

启用后，只有指定域名的邮箱才能登录。

### 仅限邀请登录

每个提供商都有 **首次登录时自动注册新用户** 开关, 默认开启。

- 开启(默认): 首次 OAuth2 登录会自动创建账号, 与之前行为一致。
- 关闭: OAuth2 登录只对已存在的账号有效。请先在 `管理后台 -> 用户` 中用对方的邮箱创建用户, 对方通过提供商登录时会进入该账号。未知邮箱返回 `403`, 不会创建账号。

已有账号的邮箱匹配不区分大小写, 管理员创建的 `Mom@Example.com` 与提供商返回的 `mom@example.com` 视为同一用户。

> [!NOTE]
> 邮件地址白名单只按域名过滤。允许 `gmail.com` 意味着所有 Gmail 用户都能登录, 需要固定人员名单时请使用仅限邀请模式。

### 要求已验证邮箱

开启 **要求提供商已验证邮箱** 后, 除非提供商返回的用户信息顶层包含值为 `true`(或字符串 `"true"`)的 `email_verified`, 否则登录将以 `403` 拒绝。缺少该字段视为未验证。

仅对会在 User Info URL 返回 `email_verified` 的 OpenID Connect 提供商开启, 例如 Google(`https://openidconnect.googleapis.com/v1/userinfo`)、Authentik、Keycloak。GitHub 的用户接口不返回该字段, 对 GitHub 开启会拒绝所有登录。

## 测试用户登录页面

![oauth2 login](/feature/oauth2-login.png)
