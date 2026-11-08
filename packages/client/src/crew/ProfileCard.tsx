import { t, usePirate } from "@openseas/boards";
import { lookFor, titleName } from "../pirate/look.js";
import { Portrait } from "../pirate/Portrait.jsx";
import { useCrew } from "../state/CrewProvider.jsx";
import { useSheet } from "../state/SheetProvider.jsx";
import { Flag } from "./Flag.jsx";
import { RankChip } from "./CrewPanel.jsx";

/** Another pirate, as a tap on their name shows them: their look and title, their crew, their record and standing, and an invitation if the viewer can send one. */
export function ProfileCard() {
  const { pirate } = usePirate();
  const { profile, closeProfile, crew, rank, invite } = useCrew();
  const { openSheet } = useSheet();
  if (!profile) return null;
  const title = titleName(profile.title);
  const me = profile.pirateId === pirate?.id;
  const crewmate = crew !== null && profile.crew?.id === crew.id;
  const canInvite = !me && !crewmate && (rank === "commodore" || rank === "officer");
  return (
    <>
      <button className="scrim scrim-top" aria-label={t("menu.close")} onClick={closeProfile} />
      <section className="card menu profile-card" role="dialog" aria-label={profile.name} data-testid="profile-card">
        <button className="icon-btn dialog-close" onClick={closeProfile} aria-label={t("menu.close")} data-testid="profile-close">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <header className="profile-head">
          <Portrait look={lookFor(profile.pirateId, profile.look)} size={60} name={profile.name} />
          <div>
            <h2>
              <i className={`dot ${profile.online ? "pip-live" : "pip-off"}`} aria-hidden="true" /> {profile.name}
              {me && <small className="muted"> ({t("ship.you")})</small>}
            </h2>
            {title && (
              <p className="pirate-title" data-testid="profile-title">
                {title}
              </p>
            )}
            <small className="muted">{profile.online ? t("profile.online") : t("profile.offline")}</small>
          </div>
        </header>
        {profile.crew ? (
          <p className="profile-crew" data-testid="profile-crew">
            <Flag flag={profile.crew.flag} size={26} /> <b>{profile.crew.name}</b> <RankChip rank={profile.crew.rank} />
          </p>
        ) : (
          <p className="muted small">{t("profile.no_crew")}</p>
        )}
        <p className="small">
          {t(profile.voyages === 1 ? "profile.voyage" : "profile.voyages", { count: profile.voyages })} · {t(profile.victories === 1 ? "profile.victory" : "profile.victories", { count: profile.victories })}
        </p>
        <div className="section">
          <h3 className="section-head">{t("profile.standing")}</h3>
          {profile.ratings.length === 0 ? (
            <p className="muted small">{t("profile.no_standing")}</p>
          ) : (
            <div className="standing">
              {profile.ratings.map((r) => (
                <span key={r.puzzle} className="tier-chip">
                  {t(`home.practice_${r.puzzle}`)} · {t(`tier.${r.tier}`)}
                </span>
              ))}
            </div>
          )}
        </div>
        {me && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              closeProfile();
              openSheet();
            }}
            data-testid="profile-edit"
          >
            {t("profile.edit")}
          </button>
        )}
        {canInvite && (
          <button
            className="btn btn-brass"
            disabled={profile.invited}
            onClick={() => {
              invite(profile.name);
              closeProfile();
            }}
            data-testid="profile-invite"
          >
            {profile.invited ? t("profile.invited") : t("profile.invite", { crew: crew!.name })}
          </button>
        )}
      </section>
    </>
  );
}
