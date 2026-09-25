"use client";
import { useEffect, useState } from "react";
import { requireActiveStaff } from "../../lib/auth";
import { getProjects, Person, Project } from "../../lib/project-work";
import TaskBoard from "../../components/TaskBoard";
export default function TasksPage() {
  const [profile, setProfile] = useState<Person | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await requireActiveStaff();
        if (!p) return;
        const rows = await getProjects(p);
        if (alive) {
          setProjects(rows);
          setProfile(p);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return (
    <main className="pw">
      <div className="eyebrow">FIELD DOCS / TEAM WORK</div>
      <h1>My tasks</h1>
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : profile ? (
        <TaskBoard profile={profile} projects={projects} />
      ) : (
        <p>Loading your workspace…</p>
      )}
    </main>
  );
}
