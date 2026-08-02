# 第三方组件

本工具包含 Mozilla PDF.js 5.7.284 的本地构建，用于在浏览器中读取并绘制 PDF 页面。

- 项目：https://github.com/mozilla/pdf.js
- 版本：5.7.284
- 许可证：Apache License 2.0
- 许可证全文：`vendor/PDFJS-LICENSE.txt`

PDF.js 已打包进 `vendor/pdfjs-bundle.js`，工具运行时无需联网。

`vendor/pdfjs-wasm/` 保留了 PDF.js 官方发行包中的 JBIG2、JPEG 2000 和色彩管理解码资源及其原始许可证，用于兼容更多扫描型 PDF。`vendor/pdfjs-wasm-data.js` 是其中 JBIG2 与 JPEG 2000 WASM 文件的 Base64 副本，供 `file://` 离线模式读取，适用相同许可证。
