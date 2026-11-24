import { useEffect, useState, type FormEvent } from "react";
import {
  fetchTelegramStatus,
  loadTelegramDraft,
  saveTelegramCredentials,
  saveTelegramDraft,
  testTelegram,
} from "../alerts/telegramClient";
import { useMarketData } from "../market/MarketData";
import { formatRefreshTime } from "../market/schedule";
import { formatInr } from "../analysis";
import {
  exportTradeBookJson,
  importTradeBookJson,
  loadTradeBook,
  saveTradeBook,
} from "../portfolio/tradeBook";
import { DEFAULT_RISK_SETTINGS, loadRiskSettings, saveRiskSettings, type RiskCapitalSettings } from "../risk/settings";

export function KiteSettings() {
  const market = useMarketData();
  const { status, needsReconnect, lastRefreshAt, error } = market;
  const connected = status.connected && !needsReconnect;
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [telegramChatMask, setTelegramChatMask] = useState<string | null>(null);
  const [botToken, setBotToken] = useState(() => loadTelegramDraft().botToken);
  const [chatId, setChatId] = useState(() => loadTelegramDraft().chatId);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramNote, setTelegramNote] = useState<string | null>(null);
  const [risk, setRisk] = useState<RiskCapitalSettings>(() => loadRiskSettings());
  const [riskSaved, setRiskSaved] = useState(false);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  useEffect(() => {
    void fetchTelegramStatus().then((status) => {
      setTelegramConfigured(status.configured);
      setTelegramChatMask(status.chatId);
    });
  }, []);

  useEffect(() => {
    saveTelegramDraft(chatId, botToken);
  }, [botToken, chatId]);

  useEffect(() => {
    const tokenOk = /^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken.trim());
    const chatOk = /^-?\d{5,20}$/.test(chatId.trim());
    if (!tokenOk || !chatOk || telegramConfigured) return;
    const timer = window.setTimeout(() => {
      setTelegramSaving(true);
      void saveTelegramCredentials(botToken, chatId)
        .then(() => fetchTelegramStatus())
        .then((status) => {
          setTelegramConfigured(status.configured);
          setTelegramChatMask(status.chatId);
          if (status.configured) {
            setBotToken("");
            saveTelegramDraft(chatId, "");
            setTelegramNote("Telegram saved automatically.");
          } else if (status.chatIdSet) {
            setTelegramNote("Chat ID saved on the server. Add the bot token to finish.");
          }
        })
        .catch((caught) =>
          setTelegramNote(caught instanceof Error ? caught.message : "Could not save Telegram automatically."),
        )
        .finally(() => setTelegramSaving(false));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [botToken, chatId, telegramConfigured]);

  useEffect(() => {
    const chatOk = /^-?\d{5,20}$/.test(chatId.trim());
    if (!chatOk || telegramConfigured) return;
    const timer = window.setTimeout(() => {
      void saveTelegramCredentials("", chatId)
        .then(() => fetchTelegramStatus())
        .then((status) => {
          setTelegramChatMask(status.chatId);
          if (status.chatIdSet && !status.configured) {
            setTelegramNote("Chat ID saved automatically on the server.");
          }
        })
        .catch(() => {
          // Full save still needs a valid bot token.
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [chatId, telegramConfigured]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveNote(null);
    try {
      await market.saveCredentials(apiKey, apiSecret);
      setApiKey("");
      setApiSecret("");
      setSaveNote("Saved on the server. Connect Kite to sign in.");
    } catch (caught) {
      setSaveNote(caught instanceof Error ? caught.message : "Could not store the Kite key.");
    } finally {
      setSaving(false);
    }
  }

  const telegramNoteTone =
    telegramNote && /fail|could not|error/i.test(telegramNote) ? "is-error" : telegramNote ? "is-success" : "";
  const saveNoteTone = saveNote && /could not|error/i.test(saveNote) ? "is-error" : saveNote ? "is-success" : "";
  const backupNoteTone =
    backupNote && /error|invalid|fail/i.test(backupNote) ? "is-error" : backupNote ? "is-success" : "";

  return (
    <section className="panel settings-panel settings-page" data-page="settings" aria-labelledby="settings-heading">
      <div className="panel-head settings-head">
        <div className="settings-hero">
          <p className="ov-brand">NSE swing desk</p>
          <h1 id="settings-heading">Settings</h1>
          <p className="lede">
            Connect Kite once. The desk reloads NSE prices at 8:45 AM IST when the session is still valid. A Zerodha
            token expires at 6:00 AM IST, and the next morning asks you to reconnect.
          </p>
        </div>
      </div>

      <article className="chart-card kite-card settings-card">
        <header className="chart-card-head settings-card-head">
          <div className="settings-card-title">
            <h2>Kite connection</h2>
            <span className={connected ? "settings-status is-connected" : "settings-status is-disconnected"}>
              {connected ? "Connected" : needsReconnect ? "Reconnect needed" : "Not connected"}
            </span>
          </div>
          <p>
            {connected
              ? `Signed in${status.userName ? ` as ${status.userName}` : ""}. The API key and secret stay in the server environment.`
              : "Prices, P&L, and charts are sample until a Kite login succeeds."}
          </p>
          <p className="refresh-line settings-refresh">
            Last successful refresh: <strong className="num">{formatRefreshTime(lastRefreshAt)}</strong>
          </p>
        </header>

        <div className="kite-actions settings-actions">
          {!connected ? (
            <button type="button" className="kite-connect settings-btn-primary" onClick={market.login}>
              {needsReconnect ? "Reconnect Kite" : "Connect Kite"}
            </button>
          ) : (
            <button type="button" className="refresh-button settings-btn-secondary" onClick={() => void market.logout()}>
              Disconnect
            </button>
          )}
          <button
            type="button"
            className="refresh-button settings-btn-secondary"
            onClick={() => void market.refresh()}
            disabled={market.loading}
          >
            {market.loading ? "Refreshing" : "Refresh Data"}
          </button>
        </div>

        {!status.configured ? (
          <form className="kite-credentials settings-form" onSubmit={(event) => void onSave(event)}>
            <p className="settings-help">
              The <span className="route-stub">.env</span> file cannot be edited in this view. Save the key and secret
              here instead. They stay on the server and are not shown again. Register{" "}
              <span className="route-stub">{status.redirectUrl}</span> in the Kite developer console.
            </p>
            <div className="settings-fields">
              <label>
                <span>API key</span>
                <input
                  name="kite-api-key"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <label>
                <span>API secret</span>
                <input
                  name="kite-api-secret"
                  type="password"
                  autoComplete="off"
                  value={apiSecret}
                  onChange={(event) => setApiSecret(event.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              className="kite-connect settings-btn-primary"
              disabled={saving || !apiKey.trim() || !apiSecret.trim()}
            >
              {saving ? "Saving" : "Save on server"}
            </button>
            {saveNote ? <p className={`settings-note ${saveNoteTone}`}>{saveNote}</p> : null}
          </form>
        ) : (
          <p className="kite-quiet settings-help">
            API key and secret are already set on the server. You do not enter them again.
          </p>
        )}

        {error ? <p className="feed-note settings-note is-error">{error}</p> : null}
      </article>

      <article className="chart-card kite-card settings-card">
        <header className="chart-card-head settings-card-head">
          <div className="settings-card-title">
            <h2>Position sizing defaults</h2>
          </div>
          <p>
            Used for Stop Loss and Suggested Qty on Pullback Swing cards. Defaults: ₹
            {DEFAULT_RISK_SETTINGS.totalCapital.toLocaleString("en-IN")}, {DEFAULT_RISK_SETTINGS.riskPercent}% risk,{" "}
            {DEFAULT_RISK_SETTINGS.maxPositionCapPercent}% max cap per name,{" "}
            {DEFAULT_RISK_SETTINGS.maxTotalOpenRiskPercent}% max open-book risk.
          </p>
        </header>
        <form
          className="risk-settings settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveRiskSettings(risk);
            setRiskSaved(true);
            window.setTimeout(() => setRiskSaved(false), 2400);
          }}
        >
          <div className="settings-fields settings-fields-3">
            <label>
              <span>Total capital (₹)</span>
              <input
                type="number"
                min={10000}
                step={10000}
                value={risk.totalCapital}
                onChange={(event) => setRisk((current) => ({ ...current, totalCapital: Number(event.target.value) }))}
              />
            </label>
            <label>
              <span>Risk per trade (%)</span>
              <input
                type="number"
                min={0.25}
                max={5}
                step={0.25}
                value={risk.riskPercent}
                onChange={(event) => setRisk((current) => ({ ...current, riskPercent: Number(event.target.value) }))}
              />
            </label>
            <label>
              <span>Max position cap (% of capital)</span>
              <input
                type="number"
                min={5}
                max={50}
                step={1}
                value={risk.maxPositionCapPercent}
                onChange={(event) =>
                  setRisk((current) => ({ ...current, maxPositionCapPercent: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              <span>Max open risk (% of capital)</span>
              <input
                type="number"
                min={1}
                max={20}
                step={0.5}
                value={risk.maxTotalOpenRiskPercent}
                onChange={(event) =>
                  setRisk((current) => ({ ...current, maxTotalOpenRiskPercent: Number(event.target.value) }))
                }
              />
            </label>
          </div>
          <RiskPreview
            capital={risk.totalCapital}
            riskPercent={risk.riskPercent}
            capPercent={risk.maxPositionCapPercent}
            openRiskPercent={risk.maxTotalOpenRiskPercent}
          />
          <div className="settings-actions">
            <button type="submit" className="refresh-button settings-btn-primary is-save">
              Save sizing defaults
            </button>
            {riskSaved ? <p className="settings-note is-success">Sizing defaults saved.</p> : null}
          </div>
        </form>
      </article>

      <article className="chart-card kite-card telegram-card settings-card">
        <header className="chart-card-head settings-card-head">
          <div className="settings-card-title">
            <h2>Telegram alerts</h2>
            <span className={telegramConfigured ? "settings-status is-connected" : "settings-status is-neutral"}>
              {telegramConfigured ? "Connected" : "Not set"}
            </span>
          </div>
          <p>
            Exit, strong buy, book profit, and caution alerts can go to your Telegram chat. The bot token is stored on
            the server only and is never shown again after you save it.
          </p>
          {telegramConfigured && telegramChatMask ? (
            <p className="refresh-line settings-refresh">
              Chat ID ending <strong className="num">{telegramChatMask}</strong>
            </p>
          ) : null}
        </header>

        <form
          className="kite-credentials settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            setTelegramSaving(true);
            setTelegramNote(null);
            void saveTelegramCredentials(botToken.trim(), chatId.trim())
              .then(() => {
                setBotToken("");
                setChatId("");
                setTelegramConfigured(true);
                setTelegramNote("Telegram credentials saved on the server. Run a test to confirm delivery.");
                return fetchTelegramStatus();
              })
              .then((status) => setTelegramChatMask(status.chatId))
              .catch((caught) =>
                setTelegramNote(caught instanceof Error ? caught.message : "Could not save Telegram credentials."),
              )
              .finally(() => setTelegramSaving(false));
          }}
        >
          <div className="settings-fields">
            <label>
              <span>Bot token</span>
              <input
                name="telegram-bot-token"
                type="password"
                autoComplete="off"
                placeholder={telegramConfigured ? "Enter only when replacing" : "From @BotFather"}
                value={botToken}
                onChange={(event) => setBotToken(event.target.value)}
              />
            </label>
            <label>
              <span>Chat ID</span>
              <input
                name="telegram-chat-id"
                autoComplete="off"
                placeholder="123456789"
                value={chatId}
                onChange={(event) => setChatId(event.target.value)}
              />
            </label>
          </div>
          <div className="kite-actions settings-actions">
            <button
              type="submit"
              className="kite-connect settings-btn-primary"
              disabled={telegramSaving || !botToken.trim() || !chatId.trim()}
            >
              {telegramSaving ? "Saving" : "Save Telegram"}
            </button>
            <button
              type="button"
              className="refresh-button settings-btn-secondary"
              disabled={telegramTesting || !telegramConfigured}
              onClick={() => {
                setTelegramTesting(true);
                setTelegramNote(null);
                void testTelegram()
                  .then(() => setTelegramNote("Test message sent. Check your Telegram chat."))
                  .catch((caught) =>
                    setTelegramNote(caught instanceof Error ? caught.message : "Test message failed."),
                  )
                  .finally(() => setTelegramTesting(false));
              }}
            >
              {telegramTesting ? "Sending" : "Test Telegram"}
            </button>
          </div>
          {telegramNote ? <p className={`settings-note ${telegramNoteTone}`}>{telegramNote}</p> : null}
        </form>

        <details className="kite-steps settings-steps">
          <summary>How to set up Telegram</summary>
          <ol className="settings-steps-list">
            <li>In Telegram, open @BotFather, send /newbot, and copy the bot token.</li>
            <li>Start a chat with your new bot (send any message so it can reach you).</li>
            <li>
              Open{" "}
              <span className="route-stub">https://api.telegram.org/bot&lt;token&gt;/getUpdates</span> in a browser and
              read <span className="route-stub">message.chat.id</span> — that is your Chat ID.
            </li>
            <li>Save both values here, then tap Test Telegram.</li>
          </ol>
        </details>
      </article>

      <article className="kite-card settings-card">
        <header className="settings-card-head">
          <div className="settings-card-title">
            <h2>Trade book backup</h2>
          </div>
          <p>
            Frozen entry stops and open-name anchors live in this browser. Export before changing machines or enabling
            algo.
          </p>
        </header>
        <div className="kite-actions settings-actions">
          <button
            type="button"
            className="refresh-button settings-btn-secondary"
            onClick={() => {
              const blob = new Blob([exportTradeBookJson(loadTradeBook())], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `nexus-trade-book-${new Date().toISOString().slice(0, 10)}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
              setBackupNote("Trade book downloaded.");
            }}
          >
            Export trade book
          </button>
          <label className="refresh-button settings-btn-secondary settings-file-btn">
            Import trade book
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then((text) => {
                  const parsed = importTradeBookJson(text);
                  if ("error" in parsed) {
                    setBackupNote(parsed.error);
                    return;
                  }
                  saveTradeBook(parsed);
                  setBackupNote(`Imported ${parsed.length} trade-book row(s).`);
                });
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {backupNote ? <p className={`settings-note ${backupNoteTone}`}>{backupNote}</p> : null}
      </article>
    </section>
  );
}

function RiskPreview({
  capital,
  riskPercent,
  capPercent,
  openRiskPercent,
}: {
  capital: number;
  riskPercent: number;
  capPercent: number;
  openRiskPercent: number;
}) {
  const safeCapital = Number.isFinite(capital) ? capital : 0;
  const safeRisk = Number.isFinite(riskPercent) ? riskPercent : 0;
  const safeCap = Number.isFinite(capPercent) ? capPercent : 0;
  const safeOpen = Number.isFinite(openRiskPercent) ? openRiskPercent : 0;
  const riskRupees = safeCapital * (safeRisk / 100);
  const halfRupees = riskRupees * 0.5;
  const capRupees = safeCapital * (safeCap / 100);
  const openRupees = safeCapital * (safeOpen / 100);
  const capitalLabel = formatInr(safeCapital);
  return (
    <div className="risk-preview settings-risk-preview">
      <article>
        <span className="dash-label">Prime risk</span>
        <strong className="num">{formatInr(riskRupees)}</strong>
        <p>
          At {safeRisk.toFixed(1)}% risk on {capitalLabel} capital, your max risk per trade.
        </p>
      </article>
      <article>
        <span className="dash-label">Amber / Caution 0.5x</span>
        <strong className="num">{formatInr(halfRupees)}</strong>
        <p>Amber regime or falling Nifty EMA 20 uses half budget per name. Standard is paused in v1.4.</p>
      </article>
      <article>
        <span className="dash-label">Position cap</span>
        <strong className="num">{formatInr(capRupees)}</strong>
        <p>{safeCap.toFixed(0)}% of capital caps one name.</p>
      </article>
      <article>
        <span className="dash-label">Open book</span>
        <strong className="num">{formatInr(openRupees)}</strong>
        <p>New triggers shrink so combined open risk stays within {safeOpen.toFixed(1)}% of capital.</p>
      </article>
    </div>
  );
}
