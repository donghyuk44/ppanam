// 유니티 재기 (결정 123·127 — 대표 "unity cli 설치했는데 이걸 왜 안써? 진행해"). 마을을 옮기는 게 아니다 — 헨리가 준 조각 목록(req_ac6c27b8, 09-14)을
// teams/design/out/kit/buildings.json 의 부품 그대로 세워 out/shots/r26-village-day-412.png 와 같은 각·크기(원근 fov 25 · 남동 45° · 35° 내려봄 · 412×915 · '작게' 60칸)로 한 장.
// 조각: ① 근정전 = buildings.json 'castle' 부품(rounded·column) ② 남산타워 = 'namsan'(dome·cylinder·cone, 나무 model 셋) ③ 집 셋 = 'home.design'(model 셋 + 기와 층·기단·문)
//       ④ 인형 둘 = 댄(male-c + boss.png + 갓) · 세라(female-b + hq-secretary.png + 리본) ⑤ 재질·빛·카메라·받침은 first-scene.md 표.
// 결과 teams/dev/out/shots/r25-unity-village-412.png — 대표가 Three.js 판과 나란히 보고 방향을 정한다(C).
//
// 돌리는 법(헤드리스, 첫 열기에 패키지 받느라 몇 분 — glTFast 가 Assets/Kenney/*.glb 를 프리팹으로 import 한다):
//   node tools/unity-prep.mjs
//   /Applications/Unity/Hub/Editor/6000.6.0f1/Unity.app/Contents/MacOS/Unity -batchmode -projectPath unity/ppanam-shot \
//     -executeMethod PpanamShot.Render -logFile unity/ppanam-shot/shot.log -quit
//   (-nographics 는 붙이지 않는다 — 그림자·조명을 그려야 한다)
// 좌표: buildings.json 은 x 동·z 남·y 위, 유니티는 z 가 앞이라 z 를 뒤집는다(glTFast 도 import 때 z 를 뒤집어 같은 모양).

using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using Newtonsoft.Json.Linq;

public static class PpanamShot
{
    const string Root = "../../";                       // unity/ppanam-shot 기준 저장소 뿌리
    const float K = 1.39f;
    const int W = 412, H = 915;
    static readonly string[] PIECES = { "castle", "namsan", "home.design" };   // 헨리 조각 목록 ①②③
    // buildings.json 의 file 은 "<키트>/<파일>" — 키트 이름 → Assets/Kenney/<폴더> (tools/unity-prep.mjs 의 KIT 와 같은 표). glb 가 옆 폴더 Textures/colormap.png 를 가리켜서 폴더째 흉내 낸다.
    static readonly Dictionary<string, string> KIT = new Dictionary<string, string> { { "commercial", "city-kit-commercial" }, { "suburban", "city-kit-suburban" }, { "characters", "mini-characters" } };
    static JObject colors;
    static int placed = 0, missing = 0;

    /** 프리팹 하나 — 못 찾으면 glTFast importer 가 남긴 이유(reportItems: code + messages)를 그대로 로그에. 첫 판은 "Failed to import (see inspector)" 만 남아 원인을 몰랐다(R25 — 색표 Textures/colormap.png 없음). importer 클래스가 internal 이라 SerializedObject 로 읽는다. */
    static GameObject Prefab(string assetPath)
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
        if (prefab != null) return prefab;
        var imp = AssetImporter.GetAtPath(assetPath);
        if (imp == null) { Debug.LogWarning("PpanamShot: import ✗ " + assetPath + " — 파일이 없다 (tools/unity-prep.mjs 를 먼저)"); return null; }
        var so = new SerializedObject(imp); var items = so.FindProperty("reportItems");
        if (items == null || !items.isArray || items.arraySize == 0) { Debug.LogWarning("PpanamShot: import ✗ " + assetPath + " — importer 가 이유를 안 남김 (" + imp.GetType().Name + ")"); return null; }
        for (int i = 0; i < items.arraySize; i++)
        {
            var it = items.GetArrayElementAtIndex(i);
            var code = it.FindPropertyRelative("code"); var msgs = it.FindPropertyRelative("messages"); var type = it.FindPropertyRelative("type");
            var parts = new List<string>();
            if (msgs != null && msgs.isArray) for (int k = 0; k < msgs.arraySize; k++) parts.Add(msgs.GetArrayElementAtIndex(k).stringValue);
            Debug.LogWarning($"PpanamShot: import ✗ {assetPath} — [{(type != null ? type.enumNames[type.enumValueIndex] : "?")}] {(code != null ? code.enumNames[Mathf.Clamp(code.enumValueIndex, 0, code.enumNames.Length - 1)] : "?")} {string.Join(" · ", parts)}");
        }
        return null;
    }

    public static void Render()
    {
        try { RenderInner(); Debug.Log("PpanamShot: SAVED"); }
        catch (Exception e) { Debug.LogError("PpanamShot: FAILED — " + e); if (Application.isBatchMode) EditorApplication.Exit(3); }
    }

    static void RenderInner()
    {
        AssetDatabase.Refresh();
        var city = JObject.Parse(File.ReadAllText(Path.Combine(Root, "server/public/world/city.json")));
        var parts = JObject.Parse(File.ReadAllText(Path.Combine(Root, "server/public/world/parts.json")));
        var buildings = JObject.Parse(File.ReadAllText(Path.Combine(Root, "teams/design/out/kit/buildings.json")));
        colors = (JObject)buildings["colors"];
        UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene);
        float w = 56, h = 30;
        var map = JObject.Parse(File.ReadAllText(Path.Combine(Root, "server/public/world/map.json")));
        if (map["scenes"]?["village"] != null) { w = (float)map["scenes"]["village"]["w"]; h = (float)map["scenes"]["village"]["h"]; }

        // ⑤ 받침 60×34×1 #d9d1bf, 바탕 #e9dccb (first-scene.md)
        var baseGo = GameObject.CreatePrimitive(PrimitiveType.Cube); baseGo.name = "base";
        baseGo.transform.position = ToUnity(w / 2, -0.5f, h / 2); baseGo.transform.localScale = new Vector3(w + 4, 1, h + 4);
        baseGo.GetComponent<Renderer>().sharedMaterial = Mat(Col("base"));
        foreach (var g in city["scenes"]["village"]["ground"] ?? new JArray())
        {
            var x0 = (float)g["x"][0]; var x1 = (float)g["x"][1]; var z0 = (float)g["z"][0]; var z1 = (float)g["z"][1];
            var q = GameObject.CreatePrimitive(PrimitiveType.Cube); q.name = "ground:" + g["kind"];
            q.transform.position = ToUnity((x0 + x1) / 2, 0.015f, (z0 + z1) / 2); q.transform.localScale = new Vector3(x1 - x0, 0.03f, z1 - z0);
            var kind = (string)g["kind"]; q.GetComponent<Renderer>().sharedMaterial = Mat(Hex((string)parts["colors"]?[kind] ?? "#cccccc"));
        }

        // ①②③ — buildings.json 부품을 그대로
        foreach (var b in buildings["buildings"] ?? new JArray())
        {
            var id = (string)b["id"]; if (Array.IndexOf(PIECES, id) < 0) continue;
            foreach (var p in b["parts"] ?? new JArray()) Part(p, id);
        }

        // ④ 인형 둘 — 댄·세라, 색표 입혀서 회사 앞 통로에
        Doll(parts, "boss", "boss.png", ToUnity(26.2f, 0, 9.5f), "gat");
        Doll(parts, "hq-secretary", "hq-secretary.png", ToUnity(28.8f, 0, 9.5f), "ribbon");

        // ⑤ 빛 — 키 #ffe1bf 왼쪽 위, 환경광 하늘/땅, 부드러운 그림자
        var light = parts["light"];
        // 세기는 Three 값(2.4, ACES 톤매핑 뒤)을 그대로 못 쓴다 — built-in 은 톤매핑이 없어 1.5 만 줘도 벽(#f4efe4)·받침이 흰색으로 날아갔다(첫 판 실측 R25). 해 1.0 · 환경광 0.6.
        // 둘째 판(placed 50)도 받침 윗면이 흰색 — 해 1.0 + 하늘 0.6 이 윗면에서 1.6× 라 #d9d1bf 가 날아갔다. 해 0.7 · 환경광 0.45(윗면 ≈ 0.98×).
        var sun = new GameObject("sun").AddComponent<Light>(); sun.type = LightType.Directional; sun.color = Hex((string)light["sun"]["color"]); sun.intensity = 0.7f;
        sun.shadows = LightShadows.Soft; sun.shadowStrength = 0.6f; sun.shadowBias = 0.02f; sun.shadowNormalBias = 0.4f;
        // 셋째 판(ceaa94d)에도 그림자 0 — 방향광 그림자 맵 크기는 화면 크기에서 나오는데 배치 모드엔 화면이 없다(0). 크기를 직접 못박는다.
        sun.shadowCustomResolution = 4096;
        sun.lightmapBakeType = LightmapBakeType.Realtime;
        // 그림자 — 둘째 판엔 하나도 안 찍혔다(나리). 카메라가 130 넘게 떨어져 있어 기본 거리 150·캐스케이드 둘이면 끊기거나 안 든다 → 거리 400, 캐스케이드 하나, CloseFit.
        QualitySettings.shadows = ShadowQuality.All; QualitySettings.shadowDistance = 400f; QualitySettings.shadowResolution = ShadowResolution.VeryHigh;
        QualitySettings.shadowCascades = 1; QualitySettings.shadowProjection = ShadowProjection.CloseFit; QualitySettings.shadowmaskMode = ShadowmaskMode.DistanceShadowmask;
        var from = light["sun"]["from"]; sun.transform.rotation = Quaternion.LookRotation(-ToUnityDir((float)from[0], (float)from[1], (float)from[2]));
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = Hex((string)light["sky"]); RenderSettings.ambientEquatorColor = Hex((string)light["ground"]); RenderSettings.ambientGroundColor = Hex((string)light["ground"]);
        RenderSettings.ambientIntensity = 0.45f;

        // ⑤ 카메라 — draw3d.js 와 같은 식: fov 25, azimuth 45, elevation 35, 짧은 변에 fit["1"]=60 칸
        var cam = new GameObject("cam").AddComponent<Camera>();
        cam.fieldOfView = (float)(city["camera"]["fov"] ?? 25); cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = Hex((string)light["background"]);
        float units = (float)city["camera"]["fit"]["1"]; float fov = cam.fieldOfView * Mathf.Deg2Rad; float aspect = (float)W / H;
        float half = Mathf.Tan(fov / 2); float dist = H <= W ? (units / 2) / half : (units / 2) / (half * aspect);
        float el = (float)city["camera"]["elevation"] * Mathf.Deg2Rad, az = (float)city["camera"]["azimuth"] * Mathf.Deg2Rad;
        var dir = ToUnityDir(Mathf.Sin(az) * Mathf.Cos(el), Mathf.Sin(el), Mathf.Cos(az) * Mathf.Cos(el));
        var target = ToUnity(w / 2, 0, h / 2);
        cam.transform.position = target + dir * dist; cam.transform.LookAt(target); cam.nearClipPlane = 0.1f; cam.farClipPlane = 800f; cam.aspect = aspect;

        var rt = new RenderTexture(W, H, 24); rt.antiAliasing = 4; cam.targetTexture = rt;
        cam.Render(); cam.Render();   // 첫 그리기는 그림자 맵을 만드는 판 — 두 번째가 진짜(배치 모드에서 한 번이면 그림자가 빠진 적이 있다)
        RenderTexture.active = rt; var tex = new Texture2D(W, H, TextureFormat.RGB24, false); tex.ReadPixels(new Rect(0, 0, W, H), 0, 0); tex.Apply(); RenderTexture.active = null;
        TiltShift(tex);   // ⑤ 흐림 — first-scene.md '초점 흐림'. 후처리 패키지 없이 찍은 픽셀에 직접(Three 판은 CSS 띠로 같은 것)
        var outPath = Path.GetFullPath(Path.Combine(Root, "teams/dev/out/shots/r25-unity-village-412.png"));
        Directory.CreateDirectory(Path.GetDirectoryName(outPath));
        File.WriteAllBytes(outPath, tex.EncodeToPNG());
        Debug.Log($"PpanamShot: placed {placed} · missing {missing} · {outPath}");
        Debug.Log($"PpanamShot: screen {Screen.width}x{Screen.height} · supportsShadows {SystemInfo.supportsShadows} · quality {QualitySettings.names[QualitySettings.GetQualityLevel()]} shadows={QualitySettings.shadows} dist={QualitySettings.shadowDistance} · sun shadows={sun.shadows} res={sun.shadowCustomResolution}");   // 그림자가 또 없으면 이 줄이 단서
        if (placed == 0) throw new Exception("부품을 하나도 못 세웠다 — Assets/Kenney/ 에 glb 가 없거나 glTFast 가 import 를 못 했다");
    }

    /* ── buildings.json 부품 하나 (village-file-contract 2판 + direction.md 10절 shape) ── */
    static void Part(JToken p, string owner)
    {
        var shape = (string)p["shape"];
        switch (shape)
        {
            case "rounded": { // x·y·z 범위 상자 (모서리 반지름은 유니티 기본 Cube 로 대신 — 첫 비교엔 충분)
                var x = Range(p["x"]); var y = Range(p["y"]); var z = Range(p["z"]);
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube); go.name = owner + ":" + (p["note"] ?? shape);
                go.transform.position = ToUnity((x.a + x.b) / 2, (y.a + y.b) / 2, (z.a + z.b) / 2); go.transform.localScale = new Vector3(x.b - x.a, y.b - y.a, z.b - z.a);
                go.GetComponent<Renderer>().sharedMaterial = Mat(Col((string)p["color"])); placed++; break; }
            case "column": case "cylinder": {
                var at = p["at"]; var y = Range(p["y"]); float r = (float)p["r"];
                var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder); go.name = owner + ":" + shape;
                go.transform.position = ToUnity((float)at[0], (y.a + y.b) / 2, (float)at[1]); go.transform.localScale = new Vector3(r * 2, (y.b - y.a) / 2, r * 2);
                go.GetComponent<Renderer>().sharedMaterial = Mat(Col((string)p["color"])); placed++; break; }
            case "cone": { // 유니티엔 원뿔 기본형이 없다 — 가는 원기둥으로 대신(안테나)
                var at = p["at"]; var y = Range(p["y"]); float r = (float)p["r"];
                var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder); go.name = owner + ":cone";
                go.transform.position = ToUnity((float)at[0], (y.a + y.b) / 2, (float)at[1]); go.transform.localScale = new Vector3(r, (y.b - y.a) / 2, r);
                go.GetComponent<Renderer>().sharedMaterial = Mat(Col((string)p["color"])); placed++; break; }
            case "dome": {
                var at = p["at"]; float r = (float)p["r"]; float y0 = (float)(p["y"] ?? 0);
                var go = GameObject.CreatePrimitive(PrimitiveType.Sphere); go.name = owner + ":dome";
                go.transform.position = ToUnity((float)at[0], y0, (float)at[1]); go.transform.localScale = Vector3.one * r * 2;
                go.GetComponent<Renderer>().sharedMaterial = Mat(Col((string)p["color"])); placed++; break; }
            case "floor": {
                var x = Range(p["x"]); var z = Range(p["z"]); float y0 = (float)(p["y"] ?? 0.01);
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube); go.name = owner + ":floor";
                go.transform.position = ToUnity((x.a + x.b) / 2, y0, (z.a + z.b) / 2); go.transform.localScale = new Vector3(x.b - x.a, 0.02f, z.b - z.a);
                go.GetComponent<Renderer>().sharedMaterial = Mat(Col((string)p["color"])); placed++; break; }
            case "model": { // Kenney glb — Assets/Kenney/<키트>/<파일이름> (tools/unity-prep.mjs 가 색표와 같이 복사). 색표는 Kenney 원본(우리 건물 색표는 아직, 헨리)
                var file = Path.GetFileName((string)p["file"]); var at = (JArray)p["at"];
                var kit = ((string)p["file"]).Contains("/") ? ((string)p["file"]).Split('/')[0] : "commercial";
                var prefab = Prefab("Assets/Kenney/" + (KIT.ContainsKey(kit) ? KIT[kit] : kit) + "/" + file);
                float ay = at.Count > 2 ? (float)at[1] : 0f, az = at.Count > 2 ? (float)at[2] : (float)at[1];   // at 은 [x, y, z] 셋(계약 2판) — 옛 둘짜리도 읽는다
                var pos = ToUnity((float)at[0], ay, az);
                if (prefab == null) { missing++; var ph = GameObject.CreatePrimitive(PrimitiveType.Cube); ph.name = "missing:" + file; ph.transform.position = pos + Vector3.up * 1.5f; ph.transform.localScale = new Vector3(1.5f, 3, 1.5f); ph.GetComponent<Renderer>().sharedMaterial = Mat(Hex("#e6dccb")); break; }
                var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab); go.name = owner + ":" + file;
                go.transform.position = pos; go.transform.localScale = Vector3.one * (float)(p["scale"] ?? K); go.transform.rotation = Quaternion.Euler(0, -(float)(p["rotY"] ?? 0), 0);
                Matte(go); placed++; break; }
            default: break;   // plane(간판) 은 글이 마케팅 몫이라 이번엔 안 그린다
        }
    }

    /* ── 인형 — glb + 디자인 색표 + 부착물 (갓·리본은 characters.json note 대로) ── */
    static void Doll(JObject parts, string key, string colormapFile, Vector3 pos, string prop)
    {
        var ch = parts["characters"][key]; if (ch == null) { missing++; return; }
        var prefab = Prefab("Assets/Kenney/" + KIT["characters"] + "/" + (string)ch["model"]);
        if (prefab == null) { missing++; var ph = GameObject.CreatePrimitive(PrimitiveType.Capsule); ph.name = "missing:" + key; ph.transform.position = pos + Vector3.up * 0.5f; ph.transform.localScale = Vector3.one * 0.5f; return; }
        var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab); go.name = "doll:" + key;
        go.transform.position = pos; go.transform.localScale = Vector3.one * K; go.transform.rotation = Quaternion.Euler(0, 180, 0);   // 남쪽(카메라 쪽)을 본다
        Matte(go);
        // 디자인 색표로 갈아 끼움 — glTFast 의 built-in 셰이더는 색표 이름이 baseColorTexture([MainTexture])라 mainTexture 로 닿는다. SkinnedMeshRenderer 도 Renderer 다.
        var tex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Kenney/people/" + colormapFile);
        if (tex == null) Debug.LogWarning("PpanamShot: 사람 색표 없음 Assets/Kenney/people/" + colormapFile);
        else foreach (var r in go.GetComponentsInChildren<Renderer>(true)) { var mats = r.sharedMaterials; for (int i = 0; i < mats.Length; i++) if (mats[i] != null) { var mm = new Material(mats[i]); mm.mainTexture = tex; if (mm.HasProperty("baseColorTexture")) mm.SetTexture("baseColorTexture", tex); mats[i] = mm; } r.sharedMaterials = mats; }
        placed++;
        float hgt = (float)ch["sourceHeight"] * K;
        if (prop == "gat")
        {   // 통 r0.175 h0.25 + 챙 r0.375 h0.03, 검정, 머리 위 (0,0.78,0.02)
            var g = new GameObject("gat"); g.transform.SetParent(go.transform, false); g.transform.localPosition = new Vector3(0, 0.78f, -0.02f);
            var tube = GameObject.CreatePrimitive(PrimitiveType.Cylinder); tube.transform.SetParent(g.transform, false); tube.transform.localPosition = new Vector3(0, 0.125f, 0); tube.transform.localScale = new Vector3(0.35f, 0.125f, 0.35f); tube.GetComponent<Renderer>().sharedMaterial = Mat(Hex("#1b1a1f"));
            var brim = GameObject.CreatePrimitive(PrimitiveType.Cylinder); brim.transform.SetParent(g.transform, false); brim.transform.localPosition = new Vector3(0, 0.015f, 0); brim.transform.localScale = new Vector3(0.75f, 0.015f, 0.75f); brim.GetComponent<Renderer>().sharedMaterial = Mat(Hex("#1b1a1f"));
        }
        else if (prop == "ribbon")
        {   // 작은 상자 둘 V 로, #c94a3a, (0.12,0.62,0.05)
            var g = new GameObject("ribbon"); g.transform.SetParent(go.transform, false); g.transform.localPosition = new Vector3(0.12f, 0.62f, -0.05f);
            for (int i = 0; i < 2; i++) { var b = GameObject.CreatePrimitive(PrimitiveType.Cube); b.transform.SetParent(g.transform, false); b.transform.localPosition = new Vector3(i == 0 ? -0.055f : 0.055f, 0, 0); b.transform.localRotation = Quaternion.Euler(0, 0, i == 0 ? 25 : -25); b.transform.localScale = new Vector3(0.12f, 0.06f, 0.04f); b.GetComponent<Renderer>().sharedMaterial = Mat(Hex("#c94a3a")); }
        }
    }

    /* ── 틸트시프트 흐림 — 가운데 띠(46~54%)는 또렷, 위·아래로 갈수록 반지름이 커진다(끝에서 MAX). 상자 흐림 세 번 = 가우스 비슷. 412×915 라 CPU 로 충분.
       셋째 판은 띠가 35~65% 라 마을 전체가 또렷한 안에 들어 흐림이 하나도 안 보였다 — 마을이 화면 38~67% 에 서니 띠를 좁혀 앞(강)·뒤(궁 지붕)가 살짝 풀리게. ── */
    const int BLUR_MAX = 8;
    static void TiltShift(Texture2D tex)
    {
        int w = tex.width, h = tex.height;
        var src = tex.GetPixels32(); var dst = new Color32[src.Length];
        for (int pass = 0; pass < 3; pass++)
        {
            // 가로
            for (int y = 0; y < h; y++)
            {
                int r = RadiusAt(y, h); if (r == 0) { Array.Copy(src, y * w, dst, y * w, w); continue; }
                for (int x = 0; x < w; x++) dst[y * w + x] = Avg(src, w, h, x, y, r, 0);
            }
            // 세로
            for (int y = 0; y < h; y++)
            {
                int r = RadiusAt(y, h); if (r == 0) { Array.Copy(dst, y * w, src, y * w, w); continue; }
                for (int x = 0; x < w; x++) src[y * w + x] = Avg(dst, w, h, x, y, 0, r);
            }
        }
        tex.SetPixels32(src); tex.Apply();
    }
    static int RadiusAt(int y, int h)
    {   // 텍스처 y 는 아래가 0. 또렷한 띠는 화면 46~54%, 거기서 멀어질수록(제곱) 커진다 — 화면 끝이 MAX
        float t = (float)y / h; float d = t < 0.46f ? (0.46f - t) / 0.46f : t > 0.54f ? (t - 0.54f) / 0.46f : 0f;
        return Mathf.RoundToInt(d * BLUR_MAX);   // 선형 — 제곱이면 마을 가장자리(띠에서 0.2~0.3)가 1px 도 안 돼 안 보인다
    }
    static Color32 Avg(Color32[] p, int w, int h, int x, int y, int rx, int ry)
    {
        int r = 0, g = 0, b = 0, n = 0;
        for (int dy = -ry; dy <= ry; dy++) { int yy = y + dy; if (yy < 0 || yy >= h) continue; for (int dx = -rx; dx <= rx; dx++) { int xx = x + dx; if (xx < 0 || xx >= w) continue; var c = p[yy * w + xx]; r += c.r; g += c.g; b += c.b; n++; } }
        return new Color32((byte)(r / n), (byte)(g / n), (byte)(b / n), 255);
    }

    // 무광(first-scene.md roughness 0.9) — glTFast built-in 셰이더는 roughnessFactor·metallicFactor, Standard 는 _Glossiness·_Metallic
    static void Matte(GameObject go) { foreach (var r in go.GetComponentsInChildren<Renderer>(true)) foreach (var m in r.sharedMaterials) if (m != null) { if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", 0.1f); if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", 0f); if (m.HasProperty("roughnessFactor")) m.SetFloat("roughnessFactor", 0.9f); if (m.HasProperty("metallicFactor")) m.SetFloat("metallicFactor", 0f); } }
    static (float a, float b) Range(JToken t) => ((float)t[0], (float)t[1]);
    static Vector3 ToUnity(float x, float y, float z) => new Vector3(x, y, -z);
    static Vector3 ToUnityDir(float x, float y, float z) => new Vector3(x, y, -z).normalized;
    static Color Col(string name) => Hex((string)colors?[name ?? ""] ?? "#ff00ff");
    static Color Hex(string s) { ColorUtility.TryParseHtmlString(s ?? "#ff00ff", out var c); return c; }
    static Material Mat(Color c) { var m = new Material(Shader.Find("Standard")); m.color = c; m.SetFloat("_Glossiness", 0.1f); m.SetFloat("_Metallic", 0f); return m; }
}
