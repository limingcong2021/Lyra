# GitHub Actions 自动部署指南

本文档详细说明了DoL-Lyra项目的自动部署流程配置，包括GitHub Pages和Cloudflare Worker的自动化部署、测试和验证。

## 工作流概述

`auto-deploy.yml` 工作流在以下情况下自动触发：
- 代码推送到 `main` 分支
- 创建新标签
- 手动触发（通过GitHub Actions界面）

## 工作流阶段

工作流包含以下主要阶段：

1. **构建阶段 (build)** - 下载DoL版本、处理文件、添加PWA支持并打包
2. **测试阶段 (test)** - 验证构建产物的完整性和语法正确性
3. **部署Pages阶段 (deploy-pages)** - 将构建产物部署到GitHub Pages和Cloudflare Pages
4. **部署Worker阶段 (deploy-worker)** - 部署Cloudflare Worker信令服务器
5. **部署验证阶段 (verify-deployment)** - 验证部署的服务是否正常运行
6. **清理阶段 (cleanup)** - 清理构建产物并记录部署结果

## 环境变量和密钥配置

### 必需的GitHub Secrets

工作流需要配置以下GitHub Secrets才能正常运行：

1. **GitHub Pages部署**
   - `GH_PAT_LYRA`: 用于部署到目标仓库的GitHub个人访问令牌，需要有仓库写入权限

2. **Cloudflare Pages部署**
   - `CF_PAGES_API_TOKEN`: Cloudflare Pages API令牌，需要有页面部署权限

3. **Cloudflare Worker部署**
   - `CF_API_TOKEN`: Cloudflare API令牌，需要有Worker编辑权限
   - `CF_ACCOUNT_ID`: Cloudflare账户ID

### 如何添加GitHub Secrets

1. 进入GitHub仓库页面
2. 点击"Settings" > "Secrets and variables" > "Actions"
3. 点击"New repository secret"
4. 输入名称和对应的值，然后点击"Add secret"

## Worker脚本配置

信令服务器Worker脚本位于 `.github/workers/signaling-server.js`，实现了以下功能：

- 房间管理（创建、加入、离开）
- 位置更新处理
- 战斗请求处理
- CORS支持
- 过期房间自动清理

### 修改Worker配置

如果需要调整Worker配置，请修改 `.github/workers/signaling-server.js` 文件，然后更新 `auto-deploy.yml` 中的以下环境变量：

```yaml
# Worker 配置
WORKER_SCRIPT_PATH: ".github/workers/signaling-server.js"  # Worker脚本路径
WORKER_NAME: "dol-lyra-signaling-worker"  # Cloudflare Worker名称
```

## 工作流自定义

### 修改部署分支

默认情况下，工作流在推送到 `main` 分支时触发。要修改触发分支，请编辑 `auto-deploy.yml` 中的 `on.push.branches` 部分：

```yaml
on:
  push:
    branches:
      - main  # 修改为你想要的分支名
      - master  # 可以添加多个分支
```

### 调整验证超时

部署验证阶段使用 `sleep` 命令等待部署生效。如果部署环境需要更长时间生效，可以调整 `verify-deployment` 阶段中的等待时间：

```yaml
- name: 等待部署完成
  run: |
    echo "等待部署生效..."
    sleep 30  # 修改为更长的等待时间（秒）
```

## 部署验证

工作流包含自动验证步骤，检查以下内容：

- GitHub Pages部署状态
- Cloudflare Pages部署状态
- 主要HTML文件的可访问性

验证结果将输出到工作流日志中，便于问题排查。

## 故障排除

### 常见问题

1. **部署失败，显示权限错误**
   - 检查GitHub Secrets是否正确配置
   - 验证访问令牌的权限是否足够

2. **Cloudflare Pages部署失败**
   - 确认`CF_PAGES_API_TOKEN`已获得正确权限
   - 检查项目名称是否与Cloudflare Pages中的项目名称匹配

3. **Worker部署失败**
   - 验证`CF_API_TOKEN`和`CF_ACCOUNT_ID`是否正确
   - 检查Worker脚本是否有语法错误

### 日志查看

要查看详细的部署日志：
1. 进入GitHub仓库
2. 点击"Actions"
3. 选择最近的工作流运行
4. 点击相应的作业查看详细日志

## 手动触发工作流

要手动触发工作流：
1. 进入GitHub仓库
2. 点击"Actions"
3. 选择"自动部署 Pages 和 Worker"工作流
4. 点击"Run workflow"按钮
5. 选择分支，然后点击"Run workflow"

## 联系支持

如果遇到配置或部署问题，请创建Issue或联系项目维护者。