import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { ApplicationsPage } from "./pages/ApplicationsPage";
import { JobsPage } from "./pages/JobsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ReviewQueuePage } from "./pages/ReviewQueuePage";
import { SourcesPage } from "./pages/SourcesPage";

const navItems = [
  { to: "/profile", label: "资料中心" },
  { to: "/sources", label: "职位源" },
  { to: "/jobs", label: "岗位" },
  { to: "/review", label: "确认队列" },
  { to: "/applications", label: "投递记录" }
] as const;

const navClassName = ({ isActive }: { isActive: boolean }) =>
  `workspace-nav-link${isActive ? " workspace-nav-link-active" : ""}`;

export default function App() {
  return (
    <div className="workspace-root">
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <p className="workspace-kicker">本地优先 ATS 流程</p>
          <h1>求职副驾</h1>
          <p className="workspace-copy">
            从结构化职位源发现岗位，或直接粘贴 hosted apply 链接，先自动预填，再由你明确确认后提交。
          </p>
        </div>

        <nav className="workspace-nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClassName}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="workspace-sidebar-foot">
          <p>仅在本地运行。</p>
          <p>复用你自己的浏览器会话。</p>
          <p>不绕过任何验证墙。</p>
        </div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-header">
          <div>
            <p className="workspace-kicker">MVP 控制台</p>
            <h2>结构化发现，浏览器侧投递。</h2>
          </div>
          <div className="workspace-header-chip">最终提交始终需要人工确认</div>
        </header>

        <section className="workspace-panel">
          <Routes>
            <Route path="/" element={<Navigate to="/profile" replace />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/review" element={<ReviewQueuePage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}
