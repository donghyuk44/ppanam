// 뼈대만 — 창 옵션은 tauri.conf.json 이 다 정한다(transparent·alwaysOnTop·decorations 없음).
// 이 파일은 아직 미검증이다(README.md 참고) — 대표 맥에서 첫 빌드로 확인한다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("세라 창을 못 띄웠습니다");
}
