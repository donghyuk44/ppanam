// 유니티 재기 (결정 123 — 대표 "unity cli 설치했는데 이걸 왜 안써? 진행해").
// 마을을 옮기는 게 아니다 — 마을 한 조각(집 몇 채 + 인형 둘셋 + 회사·남산 도형)을 city.json/parts.json 그대로 세워
// out/shots/r26-village-day-412.png 와 같은 각도·같은 크기(원근 fov 25 · 남동 45° · 35° 내려봄 · 412×915 · '작게' = 짧은 변 60칸)로 한 장 찍는다.
// 결과는 teams/dev/out/shots/r25-unity-village-412.png. 대표가 Three.js 판과 나란히 보고 방향을 정한다(C).
//
// 돌리는 법(헤드리스, 프로젝트 첫 열기에 패키지 받느라 몇 분):
//   /Applications/Unity/Hub/Editor/6000.6.0f1/Unity.app/Contents/MacOS/Unity -batchmode -nographics -projectPath unity/ppanam-shot \
//     -executeMethod PpanamShot.Render -logFile unity/ppanam-shot/shot.log -quit
//   (-nographics 로 그림자·조명이 안 나오면 -nographics 를 빼고 돌린다)
// 부품 glb 는 Assets/Kenney/ 에 있어야 한다 — tools/unity-prep.mjs 가 server/public/world/assets 에서 필요한 것만 복사한다(glTFast 가 import 해 프리팹이 된다).
// 좌표: Three.js 는 x 동·z 남, 유니티는 z 가 앞이라 z 를 뒤집는다(glTFast 도 import 때 z 를 뒤집어 같은 모양이 된다).

using System;
using System.IO;
using UnityEditor;
using UnityEngine;
using Newtonsoft.Json.Linq;

public static class PpanamShot
{
    const string Root = "../../";                       // unity/ppanam-shot 기준 저장소 뿌리
    const float K = 1.39f;                              // parts.json scale
    const int W = 412, H = 915;

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
        var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(UnityEditor.SceneManagement.NewSceneSetup.EmptyScene);
        var village = city["scenes"]["village"];
        float w = 56, h = 30;   // map.json scenes.village — Three 판과 같은 값
        var map = JObject.Parse(File.ReadAllText(Path.Combine(Root, "server/public/world/map.json")));
        if (map["scenes"]?["village"] != null) { w = (float)map["scenes"]["village"]["w"]; h = (float)map["scenes"]["village"]["h"]; }

        // 받침 + 바탕 (헨리 first-scene.md — 60×34×1 #d9d1bf, 바탕 #e9dccb, 하늘 없음)
        var colors = parts["colors"];
        var basePad = 2f;
        var baseGo = GameObject.CreatePrimitive(PrimitiveType.Cube); baseGo.name = "base";
        baseGo.transform.position = ToUnity(w / 2, -0.5f, h / 2); baseGo.transform.localScale = new Vector3(w + basePad * 2, 1, h + basePad * 2);
        baseGo.GetComponent<Renderer>().sharedMaterial = Mat(Hex((string)colors["base"]));

        // 바닥 조각
        foreach (var g in village["ground"] ?? new JArray())
        {
            var x0 = (float)g["x"][0]; var x1 = (float)g["x"][1]; var z0 = (float)g["z"][0]; var z1 = (float)g["z"][1];
            var q = GameObject.CreatePrimitive(PrimitiveType.Cube); q.name = "ground:" + g["kind"];
            q.transform.position = ToUnity((x0 + x1) / 2, 0.015f, (z0 + z1) / 2); q.transform.localScale = new Vector3(x1 - x0, 0.03f, z1 - z0);
            q.GetComponent<Renderer>().sharedMaterial = Mat(Hex((string)colors[(string)g["kind"]] ?? "#cccccc"));
        }

        // 집 — glb 프리팹(glTFast import). parts.json part → kit 폴더 + file. Assets/Kenney/<file> 로 복사돼 있어야 한다.
        int placed = 0, missing = 0;
        foreach (var b in village["buildings"] ?? new JArray())
        {
            var part = parts["parts"][(string)b["part"]]; if (part == null) continue;
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Kenney/" + (string)part["file"]);
            var at = b["at"]; var pos = ToUnity((float)at[0], 0, (float)at[1]);
            if (prefab == null) { missing++; var ph = GameObject.CreatePrimitive(PrimitiveType.Cube); ph.name = "missing:" + b["part"]; var s = part["size"]; ph.transform.localScale = new Vector3((float)s[0] * K, (float)s[1] * K, (float)s[2] * K); ph.transform.position = pos + Vector3.up * (float)s[1] * K / 2; ph.GetComponent<Renderer>().sharedMaterial = Mat(Hex("#e6dccb")); continue; }
            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab); go.transform.position = pos; go.transform.localScale = Vector3.one * K;
            go.transform.rotation = Quaternion.Euler(0, -(float)(b["rotY"] ?? 0), 0); placed++;
        }

        // 인형 — parts.characters 에서 셋(댄·테라·헨리)만, 집 앞에. glb 는 Assets/Kenney/<model>
        string[] who = { "boss", "dev-guide", "design-guide" }; int i = 0;
        foreach (var key in who)
        {
            var ch = parts["characters"][key]; if (ch == null) continue;
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Kenney/" + (string)ch["model"]);
            var pos = ToUnity(24 + i * 2.2f, 0, 17);
            if (prefab == null) { missing++; var ph = GameObject.CreatePrimitive(PrimitiveType.Capsule); ph.transform.position = pos + Vector3.up * 0.5f; ph.transform.localScale = new Vector3(0.5f, 0.5f, 0.5f); }
            else { var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab); go.transform.position = pos; go.transform.localScale = Vector3.one * K; placed++; }
            i++;
        }

        // 랜드마크 — Three 판은 코드로 짓는다. 여기선 같은 자리·크기의 도형으로만(회사 = 기와 상자 둘, 남산 = 언덕 구 + 탑 기둥 + 전망대 원반).
        foreach (var l in village["landmarks"] ?? new JArray())
        {
            var kind = (string)l["kind"];
            if (kind == "hanok")
            {
                var x0 = (float)l["x"][0]; var x1 = (float)l["x"][1]; var z0 = (float)l["z"][0]; var z1 = (float)l["z"][1]; var wallH = (float)l["wallH"];
                var body = GameObject.CreatePrimitive(PrimitiveType.Cube); body.name = "hanok:" + l["id"];
                body.transform.position = ToUnity((x0 + x1) / 2, wallH / 2, (z0 + z1) / 2); body.transform.localScale = new Vector3(x1 - x0, wallH, z1 - z0);
                body.GetComponent<Renderer>().sharedMaterial = Mat(Hex((string)colors["wall"]));
                var roof = GameObject.CreatePrimitive(PrimitiveType.Cube); roof.name = "roof:" + l["id"];
                roof.transform.position = ToUnity((x0 + x1) / 2, wallH + 0.5f, (z0 + z1) / 2); roof.transform.localScale = new Vector3(x1 - x0 + 1.2f, 1, z1 - z0 + 1.2f);
                roof.GetComponent<Renderer>().sharedMaterial = Mat(Hex((string)colors["roof"]));
            }
            else if (kind == "namsan-tower")
            {
                var at = l["at"]; var hillR = (float)l["hillR"]; var hillH = (float)l["hillH"]; var towerH = (float)l["towerH"]; var deckR = (float)l["deckR"];
                var hill = GameObject.CreatePrimitive(PrimitiveType.Sphere); hill.transform.position = ToUnity((float)at[0], 0, (float)at[1]); hill.transform.localScale = new Vector3(hillR * 2, hillH * 2, hillR * 2);
                hill.GetComponent<Renderer>().sharedMaterial = Mat(Hex((string)colors["hill"]));
                var tower = GameObject.CreatePrimitive(PrimitiveType.Cylinder); tower.transform.position = ToUnity((float)at[0], hillH + towerH / 2, (float)at[1]); tower.transform.localScale = new Vector3(0.5f, towerH / 2, 0.5f);
                tower.GetComponent<Renderer>().sharedMaterial = Mat(Hex((string)colors["tower"]));
                var deck = GameObject.CreatePrimitive(PrimitiveType.Cylinder); deck.transform.position = ToUnity((float)at[0], hillH + towerH * 0.75f, (float)at[1]); deck.transform.localScale = new Vector3(deckR * 2, 0.25f, deckR * 2);
                deck.GetComponent<Renderer>().sharedMaterial = Mat(Hex((string)colors["tower"]));
            }
        }

        // 빛 — parts.json light (키 #ffe1bf 왼쪽 위, 환경광 하늘/땅)
        var light = parts["light"];
        var sun = new GameObject("sun").AddComponent<Light>(); sun.type = LightType.Directional; sun.color = Hex((string)light["sun"]["color"]); sun.intensity = 1.6f; sun.shadows = LightShadows.Soft;
        var from = light["sun"]["from"]; sun.transform.rotation = Quaternion.LookRotation(-ToUnityDir((float)from[0], (float)from[1], (float)from[2]));
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = Hex((string)light["sky"]); RenderSettings.ambientEquatorColor = Hex((string)light["ground"]); RenderSettings.ambientGroundColor = Hex((string)light["ground"]);

        // 카메라 — draw3d.js 와 같은 식: fov 25, azimuth 45, elevation 35, 짧은 변에 fit["1"]=60 칸
        var cam = new GameObject("cam").AddComponent<Camera>();
        cam.fieldOfView = (float)(city["camera"]["fov"] ?? 25); cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = Hex((string)light["background"]);
        float units = (float)city["camera"]["fit"]["1"]; float fov = cam.fieldOfView * Mathf.Deg2Rad; float aspect = (float)W / H;
        float half = Mathf.Tan(fov / 2); float dist = H <= W ? (units / 2) / half : (units / 2) / (half * aspect);
        float el = (float)city["camera"]["elevation"] * Mathf.Deg2Rad, az = (float)city["camera"]["azimuth"] * Mathf.Deg2Rad;
        var dir = ToUnityDir(Mathf.Sin(az) * Mathf.Cos(el), Mathf.Sin(el), Mathf.Cos(az) * Mathf.Cos(el));
        var target = ToUnity(w / 2, 0, h / 2);
        cam.transform.position = target + dir * dist; cam.transform.LookAt(target); cam.nearClipPlane = 0.1f; cam.farClipPlane = 800f; cam.aspect = aspect;

        // 찍기 — RenderTexture → PNG
        var rt = new RenderTexture(W, H, 24); cam.targetTexture = rt; cam.Render();
        RenderTexture.active = rt; var tex = new Texture2D(W, H, TextureFormat.RGB24, false); tex.ReadPixels(new Rect(0, 0, W, H), 0, 0); tex.Apply(); RenderTexture.active = null;
        var outPath = Path.GetFullPath(Path.Combine(Root, "teams/dev/out/shots/r25-unity-village-412.png"));
        Directory.CreateDirectory(Path.GetDirectoryName(outPath));
        File.WriteAllBytes(outPath, tex.EncodeToPNG());
        Debug.Log($"PpanamShot: placed {placed} · missing {missing} · {outPath}");
        if (placed == 0) throw new Exception("부품을 하나도 못 세웠다 — Assets/Kenney/ 에 glb 가 없거나 glTFast 가 import 를 못 했다");
    }

    static Vector3 ToUnity(float x, float y, float z) => new Vector3(x, y, -z);
    static Vector3 ToUnityDir(float x, float y, float z) => new Vector3(x, y, -z).normalized;
    static Color Hex(string s) { ColorUtility.TryParseHtmlString(s ?? "#ff00ff", out var c); return c; }
    static Material Mat(Color c) { var m = new Material(Shader.Find("Standard")); m.color = c; m.SetFloat("_Glossiness", 0.1f); return m; }
}
