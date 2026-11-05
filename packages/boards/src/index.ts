/**
 * The presentation layer both applications share (ADR 0019): the puzzle boards and their art,
 * sound, the round runner that streams move logs to the server, and the connection to the server.
 * Nothing in here is authoritative; the server replays every round (ADR 0003).
 */
export { content, t } from "./content.js";
export { sfx, isMuted, setMuted } from "./audio.js";
export { LatencyMeter } from "./metrics.js";
export { SERVER_URL, wsUrl } from "./api/base.js";
export { ApiError, getMe, createPirate } from "./api/http.js";
export { GameSocket, type SocketStatus } from "./api/socket.js";
export { authClient } from "./api/auth.js";
export { PirateProvider, usePirate, type PirateContextValue, type PiratePhase } from "./state/PirateProvider.jsx";
export * from "./round/clock.js";
export * from "./round/round.js";
export * from "./round/useTicked.js";
export { BilgingBoard, type BoardProps as BilgingBoardProps } from "./bilging/BilgingBoard.jsx";
export { type MoveShown as BilgingMoveShown } from "./bilging/renderer.js";
export { TileIcon } from "./bilging/TileIcon.jsx";
export { tileDataUrl, type SpecialName, type TileTexture } from "./bilging/tiles.js";
export { SailingBoard, type SailingBoardProps } from "./sailing/SailingBoard.jsx";
export { DiscIcon } from "./sailing/DiscIcon.jsx";
export { CarpentryBoard, type CarpentryBoardProps } from "./carpentry/CarpentryBoard.jsx";
export { GunneryBoard, type GunneryBoardProps } from "./gunnery/GunneryBoard.jsx";
export { gunneryPieceUrl } from "./gunnery/pieces.js";
export { gunneryViewString } from "./gunnery/renderer.js";
export { NavigationBoard, type NavigationBoardProps } from "./navigation/NavigationBoard.jsx";
export { StarIcon } from "./navigation/StarIcon.jsx";
export { navigationViewString } from "./navigation/renderer.js";
export { BattleBoard, type BattleBoardProps } from "./battle/BattleBoard.jsx";
export { battleViewString } from "./battle/renderer.js";
export { SwordfightBoard, type SwordfightBoardProps } from "./swordfight/SwordfightBoard.jsx";
export { BlockIcon } from "./swordfight/BlockIcon.jsx";
export { swordfightViewString, swordfightBoardString, type RemoteBoard as MeleeRemoteBoard } from "./swordfight/renderer.js";
