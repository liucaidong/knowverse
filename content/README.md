# 内容管理规范

作品统一登记在 `content/works.json`。每项必须具有 `id`、`pillar`、`title`、`href`、`summary` 和 `status`。

- pillar: lab / gallery / puzzles
- status: live / planned / archived
- href: 以站点根目录为基准，采用 ./ 相对地址
- 为每件新作品创建单独目录和 index.html
- 新作品上线前检查直接访问地址、返回首页和移动端操作

当前采用静态 JSON 内容清单，不需要后台服务；网站自动读取并生成作品目录。
