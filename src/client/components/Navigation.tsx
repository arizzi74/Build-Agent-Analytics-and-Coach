import React from "react";

interface NavigationProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

const TABS = [
  { id: "applications", label: "Applications" },
  { id: "consumption", label: "Consumption" },
  { id: "performance", label: "Performance" },
  { id: "coach-settings", label: "Coach settings" },
];

export default function Navigation({ currentView, onNavigate }: NavigationProps) {
  return (
    <nav className="ba-nav">
      <button
        className="ba-nav__brand"
        onClick={() => onNavigate("applications")}
        type="button"
      >
        Build Agent Analytics
      </button>
      <div className="ba-nav__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`ba-nav__tab${currentView === tab.id ? " ba-nav__tab--active" : ""}`}
            onClick={() => onNavigate(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
