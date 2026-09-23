import { useState } from "react";
import { useJarvisStore } from "./store";
import { Sidebar, type Screen } from "./components/Sidebar";
import { Home } from "./screens/Home";
import { Chat } from "./screens/Chat";
import { Tasks } from "./screens/Tasks";
import { Memory } from "./screens/Memory";
import { Tools } from "./screens/Tools";
import { CommandCenter } from "./screens/CommandCenter";
import { Settings } from "./screens/Settings";

export default function App() {
  const store = useJarvisStore();
  const [screen, setScreen] = useState<Screen>("home");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="h-full flex bg-void">
      <Sidebar store={store} screen={screen} onNavigate={setScreen} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <main className="flex-1 min-w-0 flex flex-col">
        {screen === "home" && <Home store={store} />}
        {screen === "chat" && <Chat store={store} />}
        {screen === "tasks" && <Tasks store={store} />}
        {screen === "memory" && <Memory store={store} />}
        {screen === "tools" && <Tools store={store} />}
        {screen === "command" && <CommandCenter store={store} />}
        {screen === "settings" && <Settings />}
      </main>
      {/* Toasts */}
      <div className="fixed top-4 right-4 flex flex-col gap-2 z-50">
        {store.notifications.slice(-3).map((n) => (
          <div
            key={n.id}
            className="glass-strong rounded-xl px-4 py-3 text-sm shadow-lg max-w-sm cursor-pointer card-hover"
            onClick={() => store.dismissNotification(n.id)}
          >
            <div className="font-semibold text-cyan-200">{n.title}</div>
            <div className="text-slate-300">{n.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
