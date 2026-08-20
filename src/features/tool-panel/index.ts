// @author kongweiguang

// 跨功能读取右栏目录与设置时只暴露这个稳定入口，避免 settings/workspace 依赖
// tool-panel 内部实现文件，同时保留 ToolRail 内容组件的局部拆分。
export * from "./toolRailModel";
