# Axiu-Plugin

阿修自用 Yunzai-Bot v3 插件，提供扫码登录、米游社过码、自动入群审核、代发言等功能。

> MCSM 面板管理已迁移至独立插件 [MCSM-Plugin](https://github.com/AxiuCN/MCSM-Plugin)。

## 安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://github.com/AxiuCN/Axiu-Plugin.git ./plugins/Axiu-Plugin/
pnpm install --filter=Axiu-Plugin
```

## 功能

### 扫码登录

通过米游社扫码绑定 stoken，支持刷新 cookie、更新抽卡记录。移植自 xiaoyao-cvs-plugin。

- `#扫码登录` — 生成 QR 码，米游社扫码后自动绑定 stoken，查找游戏角色
- `#刷新ck` — 遍历已绑定的 stoken，刷新 cookie_token 并绑定到 cookie 系统
- `#更新抽卡记录` — 获取 authkey，触发抽卡记录拉取
- 可在锅巴后台开关

### 米游社验证码过码

自动处理米游社 API 返回的 Geetest 验证码（retcode 1034/10035），支持三种过码平台 + 手动打码回退。

- 平台：test_nine / ttocr.com / 2captcha.com
- 手动打码：内置 GT-Manual Express 服务，通过浏览器完成验证
- 配置：编辑 `config/config.yaml` 的 `api:` 段

### 自动入群审核

收到加群申请时，根据群配置的黑白名单答案自动审批，未匹配则 @通知管理员人工审核。

### 代发言

`#代@某人 消息内容` 或 `#代QQ号 消息内容`（仅 master，仅群聊），以目标用户身份重新注入消息到插件匹配流程。

## 配置

### 方式一：锅巴后台（推荐）

在锅巴后台 → 阿修插件，可视化配置入群审核规则。

### 方式二：手动编辑

- 入群审核：复制 `config/group_config.yaml.example` → `config/group_config.yaml`
- 过码配置：复制 `config/config.yaml.example` → `config/config.yaml`，填写 `api:` 段

## 部署 test_nine（可选，自动过码用）

如已有过码平台可跳过。test_nine 为本地 AI 过码服务，以子模块提供。

```bash
# 1. 拉取子模块
git submodule update --init --recursive

# 2. 下载模型文件至 tool/test_nine/test_nine/model/
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/PP-HGNetV2-B4.onnx
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/d-fine-n.onnx
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/yolo11n.onnx
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/dinov3-small.onnx
# https://huggingface.co/luguoyixiazi/model_save/resolve/main/atten.onnx

# 3. 安装依赖
pip install -r tool/test_nine/test_nine/requirements_without_train.txt

# 4. 启动（默认端口 9645）
uvicorn main:app --host 0.0.0.0 --port 9645
```

启动后在 `config/config.yaml` 的 `api:` 段设置 `type: 0`，`api` 填 `http://127.0.0.1:9645/pass_uni`。

> 模型下载地址、训练方法及更多参数详见 `tool/test_nine/test_nine/README.md`。

## 鸣谢

- [loveMys-plugin](https://github.com/kissnavel/loveMys) — 过码事件处理及配置体系借鉴自此项目
- [GT-Manual](https://gitee.com/QQ1146638442/GT-Manual) — 内置手动打码服务引用于此
- [test_nine](https://github.com/luguoyixiazi/test_nine) — 九宫格+点选 AI 过码，以子模块引入
- [ClassificationCaptchaOcr](https://github.com/taisuii/ClassificationCaptchaOcr) — resnet 模型及 V4 数据集参考
- [xiaoyao-cvs-plugin](https://github.com/ctrlcvs/xiaoyao-cvs-plugin) — 扫码登录、stoken 管理体系移植自此项目