import React, { useState, useEffect, useCallback } from "react";
import Navigation from "./components/Navigation.tsx";
import Applications from "./components/Applications.tsx";
import AppDetail from "./components/AppDetail.tsx";
import ConversationDetail from "./components/ConversationDetail.tsx";
import AgentPerformance from "./components/AgentPerformance.tsx";
import TimeSeriesView from "./components/TimeSeriesView.tsx";
import UserConsumption from "./components/UserConsumption.tsx";
import UserProfile from "./components/UserProfile.tsx";
import LoadingModal from "./components/LoadingModal.tsx";
import { QueryTrackerContext, useQueryTrackerState } from "./services/queryTracker.ts";
import "./styles/base.css";
import "./styles/shared.css";
import "./styles/applications.css";
import "./styles/app-detail.css";
import "./styles/conversation.css";
import "./styles/performance.css";
import "./styles/timeseries.css";
import "./styles/consumption.css";
import "./styles/user-profile.css";
import "./styles/json-tree.css";
import "./styles/loading.css";
import "./styles/run-script.css";
import "./styles/responsive.css";

declare const window: any;

interface ViewState {
  view: string;
  id: string | null;
  month: string | null;
}

function getViewFromUrl(): ViewState {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get("view") || "applications",
    id: params.get("id") || null,
    month: params.get("month") || null,
  };
}

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>(getViewFromUrl);
  const trackerState = useQueryTrackerState();

  useEffect(() => {
    const onPopState = () => setCurrentView(getViewFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateToView = useCallback(
    (viewName: string, id?: string | null, month?: string | null) => {
      trackerState.reset();

      const params = new URLSearchParams({ view: viewName });
      if (id) params.set("id", id);
      if (month) params.set("month", month);
      const relativePath = `${window.location.pathname}?${params}`;
      const title = `Build Agent Analytics - ${viewName}`;

      if (window.self !== window.top) {
        window.CustomEvent.fireTop("magellanNavigator.permalink.set", {
          relativePath,
          title,
        });
      }

      window.history.pushState({ viewName, id, month }, "", relativePath);
      document.title = title;
      setCurrentView({ view: viewName, id: id || null, month: month || null });
    },
    [trackerState.reset]
  );

  const { view, id, month } = currentView;

  const renderView = () => {
    switch (view) {
      case "app-detail":
        return id ? (
          <AppDetail appId={id} onNavigate={navigateToView} />
        ) : (
          <div className="ba-empty">No application selected</div>
        );
      case "conversation":
        return id ? (
          <ConversationDetail conversationId={id} onNavigate={navigateToView} />
        ) : (
          <div className="ba-empty">No conversation selected</div>
        );
      case "performance":
        return <AgentPerformance />;
      case "consumption":
        return <UserConsumption onNavigate={navigateToView} />;
      case "user-profile":
        return id ? (
          <UserProfile userId={id} onNavigate={navigateToView} />
        ) : (
          <div className="ba-empty">No user selected</div>
        );
      case "timeseries":
        return <TimeSeriesView />;
      case "applications":
      default:
        return <Applications onNavigate={navigateToView} />;
    }
  };

  return (
    <QueryTrackerContext.Provider value={trackerState}>
      <div className="ba-app">
        <Navigation currentView={view} onNavigate={(v) => navigateToView(v)} />
        <main className="ba-main">{renderView()}</main>
      </div>
      <LoadingModal />
    </QueryTrackerContext.Provider>
  );
}
