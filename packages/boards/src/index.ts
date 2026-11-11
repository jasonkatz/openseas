/**
 * The presentation layer both applications share (ADR 0019): the puzzle boards and their art,
 * sound, the round runner that streams move logs to the server, and the connection to the server.
 * Nothing in here is authoritative; the server replays every round (ADR 0003).
 */
export { content, t } from "./content.js";
export { sfx, isMuted, setMuted } from "./audio.js";
export { LatencyMeter } from "./metrics.js";
export { softwareRendered } from "./surface.js";
export { SERVER_URL, wsUrl } from "./api/base.js";
export { ApiError, getMe, createPirate } from "./api/http.js";
export { GameSocket, type SocketStatus } from "./api/socket.js";
export { authClient } from "./api/auth.js";
export { LINK_FROM_KEY, PirateProvider, usePirate, type PirateContextValue, type PiratePhase } from "./state/PirateProvider.jsx";
export * from "./round/clock.js";
export * from "./round/round.js";
export * from "./round/useTicked.js";
export * from "./round/session.js";
export * from "./round/useRoundSession.js";
export * from "./round/controls.js";
export { CoolingBoard, type BoardProps as CoolingBoardProps } from "./cooling/CoolingBoard.jsx";
export { type MoveShown as CoolingMoveShown } from "./cooling/renderer.js";
export { useCoolingControls, type CoolingControls } from "./cooling/useCoolingControls.js";
export { TileIcon } from "./cooling/TileIcon.jsx";
export { tileDataUrl, type SpecialName, type TileTexture } from "./cooling/tiles.js";
export { EnginesBoard, type EnginesBoardProps } from "./engines/EnginesBoard.jsx";
export { PelletIcon } from "./engines/PelletIcon.jsx";
export { useEnginesControls, type EnginesControls } from "./engines/useEnginesControls.js";
export { PlatingBoard, type PlatingBoardProps } from "./plating/PlatingBoard.jsx";
export { usePlatingControls, type PlatingControls } from "./plating/usePlatingControls.js";
export { GunneryBoard, type GunneryBoardProps } from "./gunnery/GunneryBoard.jsx";
export { GunneryPieceIcon } from "./gunnery/PieceIcon.jsx";
export { gunneryPieceUrl } from "./gunnery/pieces.js";
export { gunneryViewString } from "./gunnery/renderer.js";
export { useGunneryControls, type GunneryControls } from "./gunnery/useGunneryControls.js";
export { NavigationBoard, type NavigationBoardProps } from "./navigation/NavigationBoard.jsx";
export { StarIcon } from "./navigation/StarIcon.jsx";
export { navigationViewString } from "./navigation/renderer.js";
export { useNavigationControls, type NavigationControls } from "./navigation/useNavigationControls.js";
export { BattleBoard, type BattleBoardProps } from "./battle/BattleBoard.jsx";
export { battleViewString } from "./battle/renderer.js";
export { useBattleControls, type BattleControls } from "./battle/useBattleControls.js";
export { SwordfightBoard, type SwordfightBoardProps } from "./swordfight/SwordfightBoard.jsx";
export { BlockIcon } from "./swordfight/BlockIcon.jsx";
export { swordfightViewString, type RemoteBoard as MeleeRemoteBoard, type PlaceAnswer as SwordfightPlaceAnswer } from "./swordfight/renderer.js";
export { useSwordfightControls, type SwordfightControls } from "./swordfight/useSwordfightControls.js";
// The kit prototype boards are built from (ADR 0036): a PixiJS base, tweens, effects and placeholder art.
export { KitBoard, Grid } from "./kit/board.js";
export { useKitBoard, type KitBoardProps } from "./kit/useKitBoard.js";
export { KindIcon, type KindIconProps } from "./kit/KindIcon.jsx";
export { SpriteIcon, type SpriteIconProps } from "./kit/SpriteIcon.jsx";
export { INK, KINDS, kindStyle, spriteName, type PlaceholderKind, type Shape } from "./kit/art.js";
// Prototype boards (ADR 0036).
export { SalvageBoard, type SalvageBoardProps } from "./salvage/SalvageBoard.jsx";
export { OverloadBoard, type OverloadBoardProps } from "./overload/OverloadBoard.jsx";
export { DeflectorsBoard, type DeflectorsBoardProps } from "./deflectors/DeflectorsBoard.jsx";
export { ReactorBoard, type ReactorBoardProps } from "./reactor/ReactorBoard.jsx";
export { ScannerBoard, type ScannerBoardProps } from "./scanner/ScannerBoard.jsx";
export { TugBoard, type TugBoardProps } from "./tug/TugBoard.jsx";
export { RacksBoard, type RacksBoardProps } from "./racks/RacksBoard.jsx";
export { CuttingBoard, type CuttingBoardProps } from "./cutting/CuttingBoard.jsx";
