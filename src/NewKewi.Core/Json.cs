using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NewKewi.Core;

/// <summary>
/// อ่าน/เขียน JSON ของแอป
/// สำคัญ: เขียน UTF-8 **ไม่มี BOM** เสมอ — ของเดิมเคยเขียนไฟล์ติด BOM แล้วตัวอ่านพังเงียบๆ
/// กลายเป็นคิวว่างโดยไม่มี error ให้เห็น
/// </summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, // ไทยไม่ต้องถูก escape เป็น \uXXXX
        Converters = { new JsonStringEnumConverter() },
    };

    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    public static void Write<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var text = JsonSerializer.Serialize(value, Options);

        // เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อยสลับ — ไฟฟ้าดับกลางทางก็ไม่ได้ไฟล์ครึ่งๆ
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text, Utf8NoBom);
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>อ่านไฟล์ · ไฟล์หาย/พัง → คืน fallback พร้อมบอกผ่าน <paramref name="error"/></summary>
    public static T Read<T>(string path, T fallback, out string? error)
    {
        error = null;
        if (!File.Exists(path)) return fallback;
        try
        {
            // utf-8-sig: เผื่อไฟล์ที่เครื่องมืออื่นเขียนมาแล้วติด BOM เราอ่านได้ด้วย
            var text = File.ReadAllText(path, Encoding.UTF8).TrimStart('﻿');
            return JsonSerializer.Deserialize<T>(text, Options) ?? fallback;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return fallback;
        }
    }

    public static T Read<T>(string path, T fallback) => Read(path, fallback, out _);
}
