import React, { useEffect } from "react";
import { createPortal } from "react-dom";

export interface KpiDetailMetric {
  icon: string;
  label: string;
  value: string;
  tooltip?: string;
}

export interface KpiInfo {
  icon: string;
  title: string;
  description: string;
  methodology: string;
  details?: KpiDetailMetric[];
}

interface KpiInfoModalProps {
  info: KpiInfo;
  onClose: () => void;
}

export default function KpiInfoModal({ info, onClose }: KpiInfoModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div className="ba-modal-overlay" onClick={onClose}>
      <div className="ba-kpi-info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ba-kpi-info-modal__header">
          <span className="ba-kpi-info-modal__icon">{info.icon}</span>
          <span className="ba-kpi-info-modal__title">{info.title}</span>
          <button className="ba-modal__close" onClick={onClose} type="button" title="Close">✕</button>
        </div>
        <div className="ba-kpi-info-modal__body">
          <p className="ba-kpi-info-modal__description">{info.description}</p>

          {/* Detail metrics grid */}
          {info.details && info.details.length > 0 && (
            <div className="ba-kpi-info-modal__details">
              <h4 className="ba-kpi-info-modal__details-title">📊 Dettagli</h4>
              <div className="ba-kpi-info-modal__details-grid">
                {info.details.map((d, i) => (
                  <div className="ba-kpi-info-modal__detail-card" key={i} title={d.tooltip || ""}>
                    <span className="ba-kpi-info-modal__detail-icon">{d.icon}</span>
                    <span className="ba-kpi-info-modal__detail-value">{d.value}</span>
                    <span className="ba-kpi-info-modal__detail-label">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="ba-kpi-info-modal__methodology">
            <h4 className="ba-kpi-info-modal__methodology-title">📐 Come viene calcolato</h4>
            <p className="ba-kpi-info-modal__methodology-text">{info.methodology}</p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Descriptions for each KPI in the app detail view */
export const KPI_DESCRIPTIONS: Record<string, KpiInfo> = {
  user: {
    icon: "👤",
    title: "User Messages",
    description:
      "Numero totale di messaggi inviati dall'utente (umano) al Build Agent in tutte le conversazioni relative a questa applicazione.",
    methodology:
      "Vengono contati tutti i messaggi nella tabella sn_build_agent_message il cui campo 'sender' corrisponde a 'user' o 'human'. Ogni messaggio dell'utente — indipendentemente dalla lunghezza — vale 1.",
  },
  assistant: {
    icon: "🤖",
    title: "Assistant Messages",
    description:
      "Numero totale di risposte generate dal Build Agent (assistente AI) in tutte le conversazioni relative a questa applicazione.",
    methodology:
      "Vengono contati tutti i messaggi nella tabella sn_build_agent_message il cui campo 'sender' corrisponde a 'assistant' o 'bot'. Un singolo turno di risposta dell'agente — anche se contiene più tool call — viene contato come un unico messaggio.",
  },
  tokens: {
    icon: "🔢",
    title: "Tokens",
    description:
      "Stima del numero totale di token consumati (input + output + thinking) in tutte le conversazioni di questa applicazione. Rappresenta il volume di elaborazione linguistica dell'LLM.",
    methodology:
      "La stima si basa sulla lunghezza in caratteri di ogni messaggio, applicando un fattore di conversione (~4 caratteri per token per l'inglese, ~3 per testo misto). I token di input comprendono il messaggio utente e il contesto; l'output include la risposta dell'agente; il thinking include i ragionamenti interni. È una stima approssimata, non una lettura diretta dal modello.",
  },
  duration: {
    icon: "⏱️",
    title: "Implementation Duration",
    description:
      "Tempo effettivo di lavorazione dell'agente, calcolato come la somma dei tempi di ogni singolo turno di interazione. Non include i tempi morti tra una sessione e l'altra.",
    methodology:
      "Per ogni turno (da un messaggio utente all'ultima risposta dell'assistente prima del messaggio utente successivo) si calcola: timestamp_ultima_risposta − timestamp_messaggio_utente. La somma di tutti questi intervalli è il tempo di implementazione effettivo. Se riapri una vecchia conversazione dopo ore, quel gap non viene conteggiato.",
  },
  cost: {
    icon: "💎",
    title: "NowAssist Units",
    description:
      "Stima delle unità NowAssist consumate per questa applicazione. Le unità NowAssist rappresentano il costo di utilizzo della piattaforma AI di ServiceNow. Nel dettaglio qui sotto trovi anche i token consumati (input, output e thinking) per la produzione dell'applicazione.",
    methodology:
      "Ogni messaggio dell'utente consuma 25 NowAssist Units (costante fissa). Il calcolo è: numero_messaggi_utente × 25 = unità totali. Questo valore è una stima basata sul pricing standard; il consumo effettivo può variare in base al contratto. La stima dei token si basa invece sulla lunghezza in caratteri di ogni messaggio (~4 caratteri per token), suddivisa tra input, output e thinking.",
  },
};
