# test_nine

本目录包含 [test_nine](https://github.com/luguoyixiazi/test_nine) 子模块，感谢作者开源。

test_nine 基于 PP-HGNetV2-B4 + D-FINE + YOLO11n + DINOv3 实现 Geetest 九宫格分类与点选验证码自动求解，通过 FastAPI 暴露 HTTP 接口供插件调用。

## 模型

| 模型 | 用途 |
|------|------|
| [PP-HGNetV2-B4](https://huggingface.co/luguoyixiazi/model_save/resolve/main/PP-HGNetV2-B4.onnx) | 九宫格分类 |
| [d-fine-n](https://huggingface.co/luguoyixiazi/model_save/resolve/main/d-fine-n.onnx) | 点选检测 |
| [yolo11n](https://huggingface.co/luguoyixiazi/model_save/resolve/main/yolo11n.onnx) | 点选定位 |
| [dinov3-small](https://huggingface.co/luguoyixiazi/model_save/resolve/main/dinov3-small.onnx) | 特征提取 |
| [atten](https://huggingface.co/luguoyixiazi/model_save/resolve/main/atten.onnx) | 分类头 |

resnet 模型及 V4 数据集来源于 [ClassificationCaptchaOcr](https://github.com/taisuii/ClassificationCaptchaOcr)，感谢作者开源。
