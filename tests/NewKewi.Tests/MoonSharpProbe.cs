using MoonSharp.Interpreter;

namespace NewKewi.Tests;

/// <summary>ยืนยันว่า MoonSharp รันบน .NET 10 ได้และ sandbox ปิดประตูที่ต้องปิดจริง</summary>
public class MoonSharpProbe
{
    [Fact]
    public void รัน_lua_พื้นฐานได้()
    {
        var script = new Script(CoreModules.Preset_SoftSandbox);
        var v = script.DoString("return 1 + 2");
        Assert.Equal(3, v.Number);
    }

    [Fact]
    public void sandbox_ไม่มี_io_และ_os_execute()
    {
        var script = new Script(CoreModules.Preset_SoftSandbox);
        Assert.True(script.Globals.Get("io").IsNil(), "io ต้องไม่มี");

        var os = script.Globals.Get("os");
        if (!os.IsNil())
            Assert.True(os.Table.Get("execute").IsNil(), "os.execute ต้องไม่มี");
    }
}
