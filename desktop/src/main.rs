// 桌面程序入口（Windows 下隐藏控制台窗口）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    chrome_md_editor_desktop_lib::run()
}
