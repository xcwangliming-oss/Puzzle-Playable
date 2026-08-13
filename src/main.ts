import './style.css'

import * as PIXI from 'pixi.js'

import gsap from 'gsap'
import failureImpactUrl from '../assets/failure-impact.webp'
import jewelHandUrl from '../assets/ui/jewel-hand.png'
import jewelArrowUrl from '../assets/ui/jewel-arrow.png'
import soundFallUrl from '../assets/playable-audio/fall.mp3'
import soundSpawnUrl from '../assets/playable-audio/spawn.mp3'
import soundCollectUrl from '../assets/playable-audio/collect.mp3'
import soundObtainUrl from '../assets/playable-audio/obtain.mp3'
import soundShatterUrl from '../assets/playable-audio/shatter.mp3'
import soundPropElimUrl from '../assets/audio/prop_elim.ogg'

const playableBlockAssetsMap = import.meta.glob('../assets/playable-blocks/*.webp', { eager: true, import: 'default' }) as Record<string, string>;
const isStandalonePlayable = Boolean((window as any).PLAYABLE_CONFIG);
const PLAYABLE_IOS_STORE_URL = 'https://apps.apple.com/us/app/jewel-sliding-block-puzzle/id1476678178';
const PLAYABLE_ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.sportbrain.jewelpuzzle';

function openPlayableStore(): void {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const targetUrl = isIOS ? PLAYABLE_IOS_STORE_URL : PLAYABLE_ANDROID_STORE_URL;
  const mraid = (window as any).mraid;

  if (mraid && typeof mraid.open === 'function') {
    mraid.open(targetUrl);
    return;
  }

  window.location.assign(targetUrl);
}

import { damagePropForClearedRows, getPropOccupiedColumns, isValidPropLength } from './propRules.ts'
import {
  type BoardMechanic,
  createInitialPlayableBlocks,
  getFallingTopSupplyRows,
  hasContinuousScrollTopCollision,
  getNextCollectionMissionTarget,
  getBoardMechanicBehavior,
  getRisingRowsForCompletedMove,
  getRisingSupplyRowPlan,
  getTutorialHandPlacement,
  getTutorialSearchRows,
  normalizeBoardMechanic,
  pickTutorialEliminationMove,
} from './boardMechanics.ts'
import { getFailureOverlayMotion } from './failureOverlay.ts'
import { getPlayableBlockLoadError } from './playableStateContract.ts'

function showFailureImpact() {
  const overlay = document.getElementById('game-failure-overlay');
  const icon = document.getElementById('game-failure-icon');
  const motion = getFailureOverlayMotion();
  if (!overlay || !icon) return;

  overlay.style.display = 'flex';
  overlay.style.backgroundColor = `rgba(0, 0, 0, ${motion.overlayOpacity})`;
  (icon as HTMLImageElement).src = failureImpactUrl;
  gsap.killTweensOf(icon);
  gsap.set(icon, {
    autoAlpha: motion.initialAlpha,
    scale: motion.initialScale,
    transformOrigin: 'center center',
  });
  gsap.to(icon, {
    autoAlpha: motion.finalAlpha,
    scale: motion.finalScale,
    duration: motion.duration,
    ease: motion.ease,
  });
}

function hideFailureImpact() {
  const overlay = document.getElementById('game-failure-overlay');
  const icon = document.getElementById('game-failure-icon');
  if (icon) gsap.killTweensOf(icon);
  if (overlay) overlay.style.display = 'none';
}














// ---- Playable Ads Configuration & Tracking ----
let playableSwipes = 0;
let playableRows = 0;
let playableCombos = 0;
let playableCollects = 0;

let hasTriggeredCTA = false;
(window as any).triggerPlayableCTA = function() {
    if (hasTriggeredCTA || !isStandalonePlayable) return;
    hasTriggeredCTA = true;
    openPlayableStore();
};

(window as any).checkPlayableLimits = function() {
    const config = (window as any).PLAYABLE_CONFIG;
    if (!config) return;
    
    const limitSwipes = parseInt(config.limitSwipes) || 0;
    const limitRows = parseInt(config.limitRows) || 0;
    const limitCombos = parseInt(config.limitCombos) || 0;
    const limitCollects = parseInt(config.limitCollects) || 0;
    
    if (limitSwipes > 0 && playableSwipes >= limitSwipes) {
        (window as any).triggerPlayableCTA();
    } else if (limitRows > 0 && playableRows >= limitRows) {
        (window as any).triggerPlayableCTA();
    } else if (limitCombos > 0 && playableCombos >= limitCombos) {
        (window as any).triggerPlayableCTA();
    } else if (limitCollects > 0 && playableCollects >= limitCollects) {
        (window as any).triggerPlayableCTA();
    }
};

function getActiveGameRuleForExport(): string {
    if (isCollectMode) return 'collect';
    if (isColorChangingMode) return 'color';
    if (isSingleColorMode) return 'single-color';
    if (isCustomTwoColorMode) return 'custom-two-color';
    if (isRainbowMode) return 'rainbow';
    if (isRainbowFixedMode) return 'rainbow-fixed';
    if (isMaterialChangingMode) return 'material';
    if (isNoGravityMode) return 'no-gravity';
    return 'normal';
}

function getExportableCustomSoundPack(): Record<string, string> | undefined {
    const sourceOf = (audio: HTMLAudioElement) => audio.getAttribute('src') || '';
    const soundPack = {
        spawn: sourceOf(sounds.spawn),
        fall: sourceOf(sounds.fall),
        shatter: sourceOf(sounds.combos[0]),
    };
    const embeddedEntries = Object.entries(soundPack).filter(([, source]) => source.startsWith('data:'));
    return embeddedEntries.length > 0 ? Object.fromEntries(embeddedEntries) : undefined;
}

function getExportableShatterColor(): string {
    const selector = document.getElementById('select-shatter-color') as HTMLSelectElement | null;
    return selector?.value || 'default';
}

(window as any).exportCurrentGameState = function() {
    const exportedBlocks = blocks.length > 0 ? blocks : initialBoardBlocks;
    const exportBoardMechanic = getActiveBoardMechanic();
    const exportBoardAdvanceMode = exportBoardMechanic === 'falling' ? 'fixed' : exportBoardMechanic;
    const exportedColors = Array.from(new Set(
        exportedBlocks
            .map((block: any) => block.color)
            .filter((color: unknown): color is string => typeof color === 'string' && color.length > 0),
    ));
    const authoredPlayableBlocks = createInitialPlayableBlocks({
        blocks: exportedBlocks.map((block: any) => ({
            id: block.id,
            col: block.col,
            row: block.row,
            length: block.length,
            color: block.color,
            noGravity: block.noGravity,
            isCollectible: block.isCollectible,
            isProp: block.isProp,
            propType: block.propType,
            propDir: block.propDir,
        })),
        mechanic: exportBoardMechanic,
        cols: PARAMS.gridCols,
        rows: PARAMS.viewportRows,
        holeMask,
        colors: exportedColors,
    });
    const exportedPlayableBlocks = authoredPlayableBlocks;
    const exportGameRule = getActiveGameRuleForExport();
    // Automatic tutorial may only point to an authored move that clears a row.
    // Keep this as export metadata so the generator never fabricates extra blocks.
    const tutorialTarget = getPlayableTutorialTarget();
    return {
        params: { ...PARAMS },
        probs: { ...PROBS },
        blocks: exportedPlayableBlocks,
        initialBlocks: exportedPlayableBlocks,
        holeMask: Array.isArray(holeMask) ? holeMask.map(row => [...row]) : [],
        layoutDrawMask: Array.isArray(layoutDrawMask) ? layoutDrawMask.map(row => [...row]) : [],
        scriptSteps: Array.isArray(scriptSteps) ? scriptSteps : [],
        modes: {
            isCollectMode,
            isFixedBoardMode: exportBoardAdvanceMode === 'fixed',
            isFallingMode,
            boardAdvanceMode: exportBoardAdvanceMode,
            boardMechanic: exportBoardMechanic,
            gameRule: exportGameRule,
            collectedCount
        },
        isFixedBoardMode: exportBoardAdvanceMode === 'fixed',
        isFallingMode,
        boardAdvanceMode: exportBoardAdvanceMode,
        boardMechanic: exportBoardMechanic,
        gameRule: exportGameRule,
        isCollectMode,
        jewelTarget: parseInt(document.getElementById('jewel-collect-target-val')?.innerText || '0'),
        currentLevel: parseInt(document.getElementById('level-val')?.innerText || '284'),
        currentScore: parseInt(document.getElementById('score-val')?.innerText?.replace(/,/g, '') || '0'),
        background: {
            enabled: recordingBackgroundEnabled,
            dataUrl: recordingBackgroundDataUrl,
            activeId: recordingBackgroundActiveId
        },
        audio: {
            vocalPack: activeVocalPack,
            muteVocals: (document.getElementById('input-mutevocals') as HTMLInputElement | null)?.checked === true,
            soundPack: getExportableCustomSoundPack(),
        },
        shatterColor: getExportableShatterColor(),
        tutorialMoveAvailable: Boolean(tutorialTarget),
        tutorialTarget: tutorialTarget ? {
            blockId: tutorialTarget.block.id,
            fromCol: tutorialTarget.block.col,
            toCol: tutorialTarget.toCol,
            row: tutorialTarget.block.row,
            dir: tutorialTarget.dir,
            cells: tutorialTarget.cells,
            eliminationRow: tutorialTarget.eliminationRow,
            totalCleared: tutorialTarget.totalCleared,
        } : null,
        exportedBlockCount: exportedPlayableBlocks.length,
        playableTopEmptyRows: 0,
        initialScrollRow: 0,
        initialScrollY: 0
    };
};

(window as any).loadPlayableState = function(saveData: any) {
    if (!saveData) return;
    
    Object.assign(PARAMS, saveData.params || {});
    if (saveData.probs) Object.assign(PROBS, saveData.probs);
    const setPlayableInputValue = (id: string, value: number) => {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (input && Number.isFinite(value)) input.value = String(value);
    };
    setPlayableInputValue('input-cols', PARAMS.gridCols);
    setPlayableInputValue('slider-cols', PARAMS.gridCols);
    setPlayableInputValue('input-vprows', PARAMS.viewportRows);
    setPlayableInputValue('slider-vprows', PARAMS.viewportRows);
    setPlayableInputValue('input-rows', PARAMS.totalRows);
    setPlayableInputValue('slider-rows', PARAMS.totalRows);
    setPlayableInputValue('input-cellsize', PARAMS.cellSize);
    setPlayableInputValue('slider-cellsize', PARAMS.cellSize);
    
    const savedModes = saveData.modes || {};
    const loadedBoardMechanic = normalizeBoardMechanic({
        boardMechanic: saveData.boardMechanic ?? savedModes.boardMechanic,
        isFallingMode: saveData.isFallingMode ?? savedModes.isFallingMode,
        boardAdvanceMode: saveData.boardAdvanceMode ?? savedModes.boardAdvanceMode,
    });
    setBoardMechanic(loadedBoardMechanic, false);
    const loadedGameRule = saveData.gameRule ?? savedModes.gameRule ?? 'normal';
    isCollectMode = loadedGameRule === 'collect' || !!(saveData.isCollectMode ?? savedModes.isCollectMode);
    isColorChangingMode = loadedGameRule === 'color';
    isSingleColorMode = loadedGameRule === 'single-color';
    isCustomTwoColorMode = loadedGameRule === 'custom-two-color';
    isRainbowMode = loadedGameRule === 'rainbow';
    isRainbowFixedMode = loadedGameRule === 'rainbow-fixed';
    isMaterialChangingMode = loadedGameRule === 'material';
    isNoGravityMode = loadedGameRule === 'no-gravity';

    const savedBackground = saveData.background;
    if (savedBackground && typeof savedBackground.dataUrl === 'string') {
        recordingBackgroundEnabled = savedBackground.enabled === true && savedBackground.dataUrl.length > 0;
        recordingBackgroundDataUrl = recordingBackgroundEnabled ? savedBackground.dataUrl : '';
        recordingBackgroundActiveId = recordingBackgroundEnabled
            ? (typeof savedBackground.activeId === 'string' ? savedBackground.activeId : 'playable-background')
            : NO_BACKGROUND_ID;
        loadRecordingBackgroundImage(recordingBackgroundDataUrl);
        syncRecordingBackgroundUI();
    }

    const savedAudio = saveData.audio;
    if (savedAudio) {
        if (savedAudio.vocalPack === 'female' || savedAudio.vocalPack === 'male') {
            applyVocalPack(savedAudio.vocalPack);
        }
        if (typeof savedAudio.muteVocals === 'boolean') {
            const muteVocalsInput = document.getElementById('input-mutevocals') as HTMLInputElement | null;
            if (muteVocalsInput) muteVocalsInput.checked = savedAudio.muteVocals;
        }
        if (savedAudio.soundPack && typeof savedAudio.soundPack === 'object') {
            applySoundPack(savedAudio.soundPack);
        }
    }

    const savedShatterColor = typeof saveData.shatterColor === 'string'
        ? saveData.shatterColor
        : 'default';
    const shatterColorSelect = document.getElementById('select-shatter-color') as HTMLSelectElement | null;
    if (shatterColorSelect) shatterColorSelect.value = savedShatterColor;
    
    const levelEl = document.getElementById('level-val');
    if (levelEl && saveData.currentLevel !== undefined) {
        levelEl.innerText = saveData.currentLevel.toString();
    }
    const scoreEl = document.getElementById('score-val');
    if (scoreEl && saveData.currentScore !== undefined) {
        scoreEl.innerText = saveData.currentScore.toString();
    }
    
    if (isCollectMode) {
        const hud = document.getElementById('jewel-collect-hud');
        if (hud) hud.style.display = 'flex';
        const targetVal = document.getElementById('jewel-collect-target-val');
        if (targetVal && saveData.jewelTarget !== undefined) targetVal.innerText = saveData.jewelTarget.toString();
    }
    
    if (Array.isArray(saveData.holeMask)) {
        holeMask = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(false));
        for (let r = 0; r < Math.min(PARAMS.totalRows, saveData.holeMask.length); r++) {
            if (!Array.isArray(saveData.holeMask[r])) continue;
            for (let c = 0; c < Math.min(PARAMS.gridCols, saveData.holeMask[r].length); c++) {
                holeMask[r][c] = saveData.holeMask[r][c] === true;
            }
        }
    }
    if (Array.isArray(saveData.layoutDrawMask)) {
        layoutDrawMask = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(false));
        for (let r = 0; r < Math.min(PARAMS.totalRows, saveData.layoutDrawMask.length); r++) {
            if (!Array.isArray(saveData.layoutDrawMask[r])) continue;
            for (let c = 0; c < Math.min(PARAMS.gridCols, saveData.layoutDrawMask[r].length); c++) {
                layoutDrawMask[r][c] = saveData.layoutDrawMask[r][c] === true;
            }
        }
    }

    if (typeof (window as any).applyGridConfig === 'function') {
        (window as any).applyGridConfig();
    }
    if (typeof drawBoardShapeBg === 'function') drawBoardShapeBg();
    if (typeof drawHoles === 'function') drawHoles();

    // Clear existing
    blocks.forEach(b => {
        if (b.sprite.parent) b.sprite.parent.removeChild(b.sprite);
    });
    blocks = [];
    
    const savedBlocks = Array.isArray(saveData.blocks)
        ? saveData.blocks
        : (Array.isArray(saveData.initialBlocks) ? saveData.initialBlocks : []);
    initialBoardBlocks = savedBlocks.map((sb: any) => ({
        id: Number(sb.id) || 0,
        col: Number(sb.col) || 0,
        row: Number(sb.row) || 0,
        length: Math.max(1, Math.min(4, Number(sb.length) || 1)),
        color: typeof sb.color === 'string' ? sb.color : 'red',
        noGravity: !!sb.noGravity,
        isCollectible: !!sb.isCollectible,
        isProp: !!sb.isProp,
        propType: sb.propType,
        propDir: sb.propDir || 'left'
    }));
    savedBlocks.forEach((sb: any) => {
        spawnBlock(
            Number(sb.col) || 0,
            Number(sb.row) || 0,
            Math.max(1, Math.min(4, Number(sb.length) || 1)),
            typeof sb.color === 'string' ? sb.color : 'red',
            sb.id,
            sb.noGravity,
            sb.isCollectible,
            sb.isProp,
            sb.propType,
            sb.propDir || 'left'
        );
    });

    const expectedBlockCount = Number.isFinite(Number(saveData.exportedBlockCount))
        ? Number(saveData.exportedBlockCount)
        : savedBlocks.length;
    const blockLoadError = getPlayableBlockLoadError(expectedBlockCount, blocks.length);
    if (blockLoadError) throw new Error(blockLoadError);

    if ((window as any).PLAYABLE_CONFIG) {
        initialScrollRow = Math.max(0, Number(saveData.initialScrollRow) || 0);
        if (typeof clampWorldY === 'function' && typeof getWorldYFromScrollRow === 'function' && typeof setWorldY === 'function') {
            initialScrollY = clampWorldY(getWorldYFromScrollRow(initialScrollRow));
            setWorldY(initialScrollY);
        }
    } else if (savedBlocks.length > 0) {
        const minBlockRow = Math.min(...savedBlocks.map((b: any) => Number(b.row) || 0));
        initialScrollRow = Math.max(0, minBlockRow);
        if (typeof clampWorldY === 'function' && typeof getWorldYFromScrollRow === 'function' && typeof setWorldY === 'function') {
            initialScrollY = clampWorldY(getWorldYFromScrollRow(initialScrollRow));
            setWorldY(initialScrollY);
        }
    } else if (saveData.initialScrollRow !== undefined && typeof initialScrollRow !== 'undefined') {
        initialScrollRow = Number(saveData.initialScrollRow);
        if (typeof clampWorldY === 'function' && typeof getWorldYFromScrollRow === 'function' && typeof setWorldY === 'function') {
            initialScrollY = clampWorldY(getWorldYFromScrollRow(initialScrollRow));
            setWorldY(initialScrollY);
        }
    }
    if (typeof drawBoardShapeBg === 'function') drawBoardShapeBg();
    if (typeof drawHoles === 'function') drawHoles();
};



const DEFAULT_BOARD_COLS = 11;
const DEFAULT_BOARD_ROWS = 18;

const PARAMS = {



  viewportRows: DEFAULT_BOARD_ROWS,



  totalRows: DEFAULT_BOARD_ROWS,



  gridCols: DEFAULT_BOARD_COLS,



  cellSize: 50,



  scrollSpeed: 20, // px per sec



  gravityDuration: 0.3,



  shatterMode: 2,



  effectType: 'default',



}







const PROBS = {



  1: 20, 2: 40, 3: 30, 4: 10



};







// ---- State ----



type GameMode = 'play' | 'draw' | 'manual' | 'board-edit';



let currentMode: GameMode = 'play';



let manualSelectedBlock: { length: number; color: string; propDir?: 'left' | 'right' } | null = null;



let manualPreviewSprite: PIXI.Sprite | null = null;



let manualInitialStateSnapshot: string = '';



let isGameStarted = false;



let gameTime = 0;



let comboCount = 0;



let hasAnyEliminationThisStep = false;



let pendingRisingRows = 0;

let risingEliminationWavesThisMove = 0;



let isFixedBoardMode = false;



let isFallingMode = false;



let isSpawningFallingPage = false;



type BoardAdvanceMode = 'fixed' | 'rising' | 'scroll';



const isBoardAdvanceMode = (value: unknown): value is BoardAdvanceMode =>



  value === 'fixed' || value === 'rising' || value === 'scroll';



const storedBoardAdvanceMode = localStorage.getItem('boardAdvanceMode');



let boardAdvanceMode: BoardAdvanceMode =



  isBoardAdvanceMode(storedBoardAdvanceMode) ? storedBoardAdvanceMode : 'scroll';



let boardMechanic: BoardMechanic = normalizeBoardMechanic({



  boardMechanic: localStorage.getItem('boardMechanic'),



});



boardAdvanceMode = boardMechanic === 'falling' ? 'fixed' : boardMechanic;



isFallingMode = boardMechanic === 'falling';



isFixedBoardMode = boardMechanic === 'fixed';



let scriptPlaybackAdvanceMode: BoardAdvanceMode | null = null;







function getActiveBoardAdvanceMode(): BoardAdvanceMode {



  return scriptPlaybackAdvanceMode || boardAdvanceMode;



}







function isRisingAdvanceActive(): boolean {



  return !isFallingMode && getActiveBoardAdvanceMode() === 'rising';



}







function isFixedAdvanceActive(): boolean {



  return !isFallingMode && getActiveBoardAdvanceMode() === 'fixed';



}







function syncBoardAdvanceFlags(mode: BoardAdvanceMode = getActiveBoardAdvanceMode()) {



  isFixedBoardMode = !isFallingMode && mode === 'fixed';



}







function getSavedBoardAdvanceMode(savedMode: unknown, legacyFixed?: unknown): BoardAdvanceMode {



  if (isBoardAdvanceMode(savedMode)) return savedMode;



  if (legacyFixed === true) return 'fixed';



  return boardAdvanceMode;



}



let isColorChangingMode = false;



let isSingleColorMode = false;



let isCustomTwoColorMode = false;



let isCollectMode = false;



let collectedCount = 0;



let activeCollectibleId: string | number = 'coin';



let activeCollectibleTexture: PIXI.Texture | null = null;



let activeCollectibleTextures: PIXI.Texture[] | null = null;



let customCollectibles: { id: number; name: string; texture: string }[] = [];



const SINGLE_COLORS = ['pink', 'blue', 'yellow', 'green', 'red'];



let singleColorIndex = 0;



let isRainbowMode = false;



let isRainbowFixedMode = false;



let isMaterialChangingMode = false;



let isNoGravityMode = false;



let activeMaterialIndex = 0;



let colorPairIndex = 0;



let selectedTwoColors = ['red', 'blue'];



let assetsLoaded = false;



const COLOR_PAIRS = [



  ['pink', 'blue'],



  ['red', 'blue'],



  ['yellow', 'blue'],



  ['green', 'pink'],



  ['red', 'green'],



  ['pink', 'yellow'],



];



const RAINBOW_PALETTE = ['pink','blue','yellow','green','red'];



const COLOR_LABELS: Record<string, string> = {



  red: '红',



  blue: '蓝',



  green: '绿',



  yellow: '黄',



  pink: '粉'



};



const getColorLabel = (color: string) => COLOR_LABELS[color] || color;



let rowColors: string[] = [];







// Gameplay Mode State



let isGameplayMode = false;



let gameplayTimer: any = null;



const gameplayRiseInterval = 3500;







// Script Editor State



interface ScriptStep {



  blockId?: number;



  fromCol: number;



  row: number;



  toCol: number;



  scrollY?: number;



  scrollRow?: number;



  gravityMaxRow?: number;



  eliminatedRows?: number[];



  eliminationWaves?: number[][];



}







interface RepairScriptOptions {



  preserveStepIdentity?: boolean;



  preserveExistingEliminations?: boolean;



  mergeDetectedEliminations?: boolean;



}







interface PlayScriptOptions {



  resumeFromSelected?: boolean;



}







interface BoardBlockState {



  id?: number;



  col: number;



  row: number;



  length: number;



  color: string;



  noGravity?: boolean;



  isCollectible?: boolean;



  isProp?: boolean;



  propType?: 'row-bomb' | 'peppermint';

  propDir?: 'left' | 'right';



}







let scriptSteps: ScriptStep[] = [];



let selectedStepIndex: number | null = null;



let activeSimulatingStepIndex: number | null = null;



let activeRecordingStepIndex: number | null = null;



let activeEliminationWaveIndex = 0;



let activeRepairEliminationBudget: number | null = null;



let isRepairingScript = false;



let isRecordingSteps = false;



let isPlayingScript = false;



let isPlayingStepTransition = false;



let scriptPlaybackStopRequested = false;



let initialBoardBlocks: BoardBlockState[] = [];



let initialScrollY = 0;



let initialScrollRow = 0;



let syncModeButtonsUI: () => void = () => {};



const RECORDED_SCROLL_TRACK_EPSILON = 1;



let recordedScrollAnimationToken = 0;







function getScrollRowFromWorldY(worldY: number, cellSize: number = PARAMS.cellSize): number {



  if (!Number.isFinite(worldY) || !Number.isFinite(cellSize) || cellSize <= 0) return 0;



  return -worldY / cellSize;



}







function getWorldYFromScrollRow(scrollRow: number): number {



  return -(Number.isFinite(scrollRow) ? scrollRow : 0) * PARAMS.cellSize;



}







function getStepScrollRow(step: ScriptStep, fallbackCellSize: number = PARAMS.cellSize): number {



  if (Number.isFinite(step.scrollRow)) return step.scrollRow!;



  if (Number.isFinite(step.scrollY)) return getScrollRowFromWorldY(step.scrollY!, fallbackCellSize);



  return initialScrollRow;



}







function getStepScrollY(step: ScriptStep): number {



  return clampWorldY(getWorldYFromScrollRow(getStepScrollRow(step)));



}







function setStepScrollFromWorldY(step: ScriptStep, worldY: number, cellSize: number = PARAMS.cellSize) {



  const clampedWorldY = clampWorldY(worldY);



  step.scrollRow = getScrollRowFromWorldY(clampedWorldY, cellSize);



  step.scrollY = clampedWorldY;



}







function syncRecordedScrollPixelsToCurrentCellSize() {



  initialScrollY = clampWorldY(getWorldYFromScrollRow(initialScrollRow));



  initialScrollRow = getScrollRowFromWorldY(initialScrollY);



  scriptSteps.forEach(step => {



    if (!Number.isFinite(step.scrollRow)) {



      step.scrollRow = getStepScrollRow(step);



    }



    const clampedScrollY = getStepScrollY(step);



    step.scrollRow = getScrollRowFromWorldY(clampedScrollY);



    step.scrollY = clampedScrollY;



  });



}







function hasMeaningfulRecordedScrollTrack(steps: ScriptStep[] = scriptSteps): boolean {



  const values = [initialScrollRow, ...steps



    .map(step => getStepScrollRow(step))



    .filter((value): value is number => Number.isFinite(value))];



  if (values.length < 2) return false;



  return Math.max(...values) - Math.min(...values) > RECORDED_SCROLL_TRACK_EPSILON;



}







function stopWorldAdvanceTweens(clearAnimating = false) {



  pendingRisingRows = 0;



  recordedScrollAnimationToken++;



  if (worldContainer) gsap.killTweensOf(worldContainer);



  if (clearAnimating) isAnimating = false;



  setWorldY(worldContainer ? worldContainer.y : virtualScrollY);



}



let activeParticles: {



  sprite: PIXI.Graphics;



  vx: number;



  vy: number;



  alphaDecay: number;



  scaleDecay: number;



  gravity?: number;



  vRot?: number;



}[] = [];







function setButtonLabel(id: string, icon: string, label: string) {



  const el = document.getElementById(id);



  if (el) el.innerHTML = `<span class="icon">${icon}</span>${label}`;



}







function repairChineseUI() {



  const textMap: Record<string, string> = {



    '排面存档管理': '排面存档管理',



    '固定排面存档管理': '固定排面存档管理',



    '演示剧本存档': '演示剧本存档',



    '步骤列表': '步骤列表',



    '列数': '列数',



    '行数': '行数',



    '总行': '总行',



    '格高': '格高',



    '速度': '速度',



    '分数': '分数',



    '绿幕': '绿幕',



    '隐藏文案': '隐藏文案',



    '隐藏破碎': '隐藏破碎',



    '关闭人声': '关闭人声',



    '破碎方式': '破碎方式',



    '破碎颜色': '破碎颜色',



    '默认': '默认',



    '读取': '读取',



    '删除': '删除',



    '保存': '保存'



  };







  Object.keys(textMap).forEach(key => {



    const target = textMap[key];



    document.querySelectorAll('*').forEach(el => {



      if (el.children.length === 0 && el.textContent && el.textContent.includes(key)) {



        el.textContent = el.textContent.replace(key, target);



      }



    });



  });



}







// Preloaded materials cache



const preloadedMaterials = new Map<number, Record<string, PIXI.Texture>>();



let preloadedMaterialIds: number[] = [];







class MaterialDB {



  private dbName = 'BlockPuzzleDB';



  private storeName = 'materials';



  private db: IDBDatabase | null = null;







  async init(): Promise<void> {



    return new Promise((resolve, reject) => {



      const request = indexedDB.open(this.dbName, 5);



      request.onupgradeneeded = () => {



        const db = request.result;



        if (!db.objectStoreNames.contains('materials')) {



          db.createObjectStore('materials', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('sounds')) {



          db.createObjectStore('sounds', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('effects')) {



          db.createObjectStore('effects', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('collectibles')) {



          db.createObjectStore('collectibles', { keyPath: 'id' });



        }



      };



      request.onsuccess = () => {



        this.db = request.result;



        resolve();



      };



      request.onerror = () => reject(request.error);



    });



  }







  async getAllMaterials(): Promise<{ id: number; name: string; hasTextures: boolean }[]> {



    return new Promise((resolve, reject) => {



      if (!this.db) return resolve([]);



      const transaction = this.db.transaction(this.storeName, 'readonly');



      const store = transaction.objectStore(this.storeName);



      const request = store.getAll();



      request.onsuccess = () => {



        const list = request.result || [];



        resolve(list.map((item: any) => ({



          id: item.id,



          name: item.name,



          hasTextures: item.textures && Object.keys(item.textures).length > 0



        })));



      };



      request.onerror = () => reject(request.error);



    });



  }







  async getMaterialTextures(id: number): Promise<Record<string, string> | null> {



    return new Promise((resolve, reject) => {



      if (!this.db) return resolve(null);



      const transaction = this.db.transaction(this.storeName, 'readonly');



      const store = transaction.objectStore(this.storeName);



      const request = this.db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(id);



      request.onsuccess = () => {



        if (request.result) {



          resolve(request.result.textures);



        } else {



          resolve(null);



        }



      };



      request.onerror = () => reject(request.error);



    });



  }







  async addMaterial(name: string): Promise<number> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const id = Date.now();



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const request = store.add({ id, name, textures: {} });



      request.onsuccess = () => resolve(id);



      request.onerror = () => reject(request.error);



    });



  }







  async saveMaterialTextures(id: number, textures: Record<string, string>): Promise<void> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const getRequest = store.get(id);



      getRequest.onsuccess = () => {



        const data = getRequest.result;



        if (data) {



          data.textures = textures;



          const putRequest = store.put(data);



          putRequest.onsuccess = () => resolve();



          putRequest.onerror = () => reject(putRequest.error);



        } else {



          reject(new Error(`Material pack not found for ID: ${id}`));



        }



      };



      getRequest.onerror = () => reject(getRequest.error);



    });



  }







  async deleteMaterial(id: number): Promise<void> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const request = store.delete(id);



      request.onsuccess = () => resolve();



      request.onerror = () => reject(request.error);



    });



  }



}







class SoundDB {



  private dbName = 'BlockPuzzleDB';



  private storeName = 'sounds';



  private db: IDBDatabase | null = null;







  async init(): Promise<void> {



    return new Promise((resolve, reject) => {



      const request = indexedDB.open(this.dbName, 5);



      request.onupgradeneeded = () => {



        const db = request.result;



        if (!db.objectStoreNames.contains('materials')) {



          db.createObjectStore('materials', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains(this.storeName)) {



          db.createObjectStore(this.storeName, { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('effects')) {



          db.createObjectStore('effects', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('collectibles')) {



          db.createObjectStore('collectibles', { keyPath: 'id' });



        }



      };



      request.onsuccess = () => {



        this.db = request.result;



        resolve();



      };



      request.onerror = () => reject(request.error);



    });



  }







  async getAllSounds(): Promise<{ id: number; name: string; hasSounds: boolean }[]> {



    return new Promise((resolve, reject) => {



      if (!this.db) return resolve([]);



      const transaction = this.db.transaction(this.storeName, 'readonly');



      const store = transaction.objectStore(this.storeName);



      const request = store.getAll();



      request.onsuccess = () => {



        const list = request.result || [];



        resolve(list.map((item: any) => ({



          id: item.id,



          name: item.name,



          hasSounds: item.sounds && Object.keys(item.sounds).length > 0



        })));



      };



      request.onerror = () => reject(request.error);



    });



  }







  async getSoundFiles(id: number): Promise<Record<string, string> | null> {



    return new Promise((resolve, reject) => {



      if (!this.db) return resolve(null);



      const transaction = this.db.transaction(this.storeName, 'readonly');



      const store = transaction.objectStore(this.storeName);



      const request = store.get(id);



      request.onsuccess = () => {



        if (request.result) {



          resolve(request.result.sounds);



        } else {



          resolve(null);



        }



      };



      request.onerror = () => reject(request.error);



    });



  }







  async addSound(name: string): Promise<number> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const id = Date.now();



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const request = store.add({ id, name, sounds: {} });



      request.onsuccess = () => resolve(id);



      request.onerror = () => reject(request.error);



    });



  }







  async saveSoundFiles(id: number, sounds: Record<string, string>): Promise<void> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const getRequest = store.get(id);



      getRequest.onsuccess = () => {



        const data = getRequest.result;



        if (data) {



          data.sounds = sounds;



          const putRequest = store.put(data);



          putRequest.onsuccess = () => resolve();



          putRequest.onerror = () => reject(putRequest.error);



        } else {



          reject(new Error(`Sound pack not found for ID: ${id}`));



        }



      };



      getRequest.onerror = () => reject(getRequest.error);



    });



  }







  async deleteSound(id: number): Promise<void> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const request = store.delete(id);



      request.onsuccess = () => resolve();



      request.onerror = () => reject(request.error);



    });



  }



}







class EffectDB {



  private dbName = 'BlockPuzzleDB';



  private storeName = 'effects';



  private db: IDBDatabase | null = null;







  async init(): Promise<void> {



    return new Promise((resolve, reject) => {



      const request = indexedDB.open(this.dbName, 5);



      request.onupgradeneeded = () => {



        const db = request.result;



        if (!db.objectStoreNames.contains('materials')) {



          db.createObjectStore('materials', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('sounds')) {



          db.createObjectStore('sounds', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains(this.storeName)) {



          db.createObjectStore(this.storeName, { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('collectibles')) {



          db.createObjectStore('collectibles', { keyPath: 'id' });



        }



      };



      request.onsuccess = () => {



        this.db = request.result;



        resolve();



      };



      request.onerror = () => reject(request.error);



    });



  }







  async getAllEffects(): Promise<{ id: number; name: string; hasEffects: boolean }[]> {



    return new Promise((resolve, reject) => {



      if (!this.db) return resolve([]);



      const transaction = this.db.transaction(this.storeName, 'readonly');



      const store = transaction.objectStore(this.storeName);



      const request = store.getAll();



      request.onsuccess = () => {



        const list = request.result || [];



        resolve(list.map((item: any) => ({



          id: item.id,



          name: item.name,



          hasEffects: item.frames && Object.keys(item.frames).length > 0



        })));



      };



      request.onerror = () => reject(request.error);



    });



  }







  async getEffectFiles(id: number): Promise<Record<string, string> | null> {



    return new Promise((resolve, reject) => {



      if (!this.db) return resolve(null);



      const transaction = this.db.transaction(this.storeName, 'readonly');



      const store = transaction.objectStore(this.storeName);



      const request = store.get(id);



      request.onsuccess = () => {



        if (request.result) {



          resolve(request.result.frames);



        } else {



          resolve(null);



        }



      };



      request.onerror = () => reject(request.error);



    });



  }







  async addEffect(name: string): Promise<number> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const id = Date.now();



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const request = store.add({ id, name, frames: {} });



      request.onsuccess = () => resolve(id);



      request.onerror = () => reject(request.error);



    });



  }







  async saveEffectFiles(id: number, frames: Record<string, string>): Promise<void> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const getRequest = store.get(id);



      getRequest.onsuccess = () => {



        const data = getRequest.result;



        if (data) {



          data.frames = frames;



          const putRequest = store.put(data);



          putRequest.onsuccess = () => resolve();



          putRequest.onerror = () => reject(putRequest.error);



        } else {



          reject(new Error(`Effect pack not found for ID: ${id}`));



        }



      };



      getRequest.onerror = () => reject(getRequest.error);



    });



  }







  async deleteEffect(id: number): Promise<void> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const request = store.delete(id);



      request.onsuccess = () => resolve();



      request.onerror = () => reject(request.error);



    });



  }



}







class CollectibleDB {



  private dbName = 'BlockPuzzleDB';



  private storeName = 'collectibles';



  private db: IDBDatabase | null = null;







  async init(): Promise<void> {



    return new Promise((resolve, reject) => {



      const request = indexedDB.open(this.dbName, 5);



      request.onupgradeneeded = () => {



        const db = request.result;



        if (!db.objectStoreNames.contains('materials')) {



          db.createObjectStore('materials', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('sounds')) {



          db.createObjectStore('sounds', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains('effects')) {



          db.createObjectStore('effects', { keyPath: 'id' });



        }



        if (!db.objectStoreNames.contains(this.storeName)) {



          db.createObjectStore(this.storeName, { keyPath: 'id' });



        }



      };



      request.onsuccess = () => {



        this.db = request.result;



        resolve();



      };



      request.onerror = () => reject(request.error);



    });



  }







  async getAllCollectibles(): Promise<{ id: number; name: string; texture: string }[]> {



    return new Promise((resolve, reject) => {



      if (!this.db) return resolve([]);



      const transaction = this.db.transaction(this.storeName, 'readonly');



      const store = transaction.objectStore(this.storeName);



      const request = store.getAll();



      request.onsuccess = () => {



        resolve(request.result || []);



      };



      request.onerror = () => reject(request.error);



    });



  }







  async addCollectible(name: string, texture: string): Promise<number> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const id = Date.now();



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const request = store.add({ id, name, texture });



      request.onsuccess = () => resolve(id);



      request.onerror = () => reject(request.error);



    });



  }







  async deleteCollectible(id: number): Promise<void> {



    return new Promise((resolve, reject) => {



      if (!this.db) return reject(new Error('Database not initialized'));



      const transaction = this.db.transaction(this.storeName, 'readwrite');



      const store = transaction.objectStore(this.storeName);



      const request = store.delete(id);



      request.onsuccess = () => resolve();



      request.onerror = () => reject(request.error);



    });



  }



}







const materialDB = new MaterialDB();



const soundDB = new SoundDB();



const effectDB = new EffectDB();



const collectibleDB = new CollectibleDB();







let activeEffectTextures: PIXI.Texture[] = [];







async function applyEffectPack(frames: Record<string, string>) {



  activeEffectTextures = [];



  const keys = Object.keys(frames).sort((a, b) => parseInt(a) - parseInt(b));



  



  const loadPromises = keys.map(async (key) => {



    const base64Src = frames[key];



    const uniqueAlias = `custom_effect_frame_${key}_${Date.now()}_${Math.random()}`;



    const texture = await PIXI.Assets.load<PIXI.Texture>({



      src: base64Src,



      alias: uniqueAlias



    });



    return { index: parseInt(key), texture };



  });







  const results = await Promise.all(loadPromises);



  results.sort((a, b) => a.index - b.index);



  activeEffectTextures = results.map(r => r.texture);



}







function restoreDefaultEffects() {



  activeEffectTextures = [];



}







function fileToBase64(file: File): Promise<string> {



  return new Promise((resolve, reject) => {



    const reader = new FileReader();



    reader.onload = () => resolve(reader.result as string);



    reader.onerror = () => reject(reader.error);



    reader.readAsDataURL(file);



  });



}







async function applyMaterialPack(textures: Record<string, string>) {



  const colors = ['red', 'blue', 'green', 'yellow', 'pink'];



  for (const c of colors) {



    for (let l = 1; l <= 4; l++) {



      const alias = `${c}-${l}`;



      const base64Src = textures[alias];



      if (!base64Src) continue;



      



      const texture = await PIXI.Assets.load<PIXI.Texture>(base64Src);



      PIXI.Assets.cache.set(alias, texture);



      



      blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



        if (b.color === c && b.length === l) {



          b.sprite.texture = texture;



        }



      });



    }



  }



}







async function restoreDefaultTextures() {



  const colors = ['red', 'blue', 'green', 'yellow', 'pink'];



  for (const c of colors) {



    for (let l = 1; l <= 4; l++) {



      const alias = `${c}-${l}`;



      const texture = await PIXI.Assets.load<PIXI.Texture>(alias);



      PIXI.Assets.cache.set(alias, texture);



      



      blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



        if (b.color === c && b.length === l) {



          b.sprite.texture = texture;



        }



      });



    }



  }



}







const gemShatterTextures: Record<string, PIXI.Texture[]> = {};
let gemShatterPreloaded = false;

async function preloadGemShatterEffects() {
  if (isStandalonePlayable) return;
  if (gemShatterPreloaded) return;
  gemShatterPreloaded = true;
  const colors = ['red', 'blue', 'green', 'yellow', 'pink'];
  const colorMap: Record<string, string> = {
    'red': '红色', 'blue': '蓝色', 'green': '绿色', 'yellow': '黄色', 'pink': '粉色'
  };
  const promises = [];
  for (const c of colors) {
    gemShatterTextures[c] = [];
    const folderName = colorMap[c];
    for (let i = 1; i <= 41; i++) {
      const idxStr = i.toString().padStart(5, '0');
      const filename = c === 'blue' ? `Armature_5_1_${idxStr}.png` : `${folderName}_${idxStr}.png`;
      const url = `assets/gem-shatter-new/${encodeURIComponent(folderName)}/${encodeURIComponent(filename)}`;
      promises.push(PIXI.Assets.load(url).then(tex => {
        gemShatterTextures[c][i - 1] = tex;
      }).catch((e) => { console.log('Failed to load tex', url, e); }));
    }
  }
  await Promise.all(promises);
}

async function preloadAllMaterials() {
  if (!isStandalonePlayable) await preloadGemShatterEffects();

  try {



    const list = await materialDB.getAllMaterials();



    console.log('preloadAllMaterials list from DB:', list);



    const ids: number[] = [];



    const loadPromises: Promise<void>[] = [];







    for (const item of list) {



      if (!item.hasTextures) continue;



      ids.push(item.id);



      if (preloadedMaterials.has(item.id)) continue;



      



      console.log('Scheduling textures preload for pack:', item.id, item.name);



      const p = (async () => {



        const texturesData = await materialDB.getMaterialTextures(item.id);



        if (texturesData) {



          const textureRecord: Record<string, PIXI.Texture> = {};



          const colors = ['red', 'blue', 'green', 'yellow', 'pink'];



          const texturesPromises: Promise<void>[] = [];



          



          for (const c of colors) {



            for (let l = 1; l <= 4; l++) {



              const alias = `${c}-${l}`;



              const base64Src = texturesData[alias];



              if (base64Src) {



                const lp = PIXI.Assets.load<PIXI.Texture>(base64Src).then(texture => {



                  textureRecord[alias] = texture;



                });



                texturesPromises.push(lp);



              }



            }



          }



          await Promise.all(texturesPromises);



          preloadedMaterials.set(item.id, textureRecord);



          console.log('Successfully preloaded pack:', item.id, 'textures count:', Object.keys(textureRecord).length);



        }



      })();



      loadPromises.push(p);



    }



    await Promise.all(loadPromises);



    preloadedMaterialIds = ids;



    console.log('preloadAllMaterials finished. preloadedMaterialIds:', preloadedMaterialIds);



  } catch (err) {



    console.error('Error preloading materials:', err);



  }



}







function applyCachedMaterialPack(cachedTextures: Record<string, PIXI.Texture>) {



  const colors = ['red', 'blue', 'green', 'yellow', 'pink'];



  for (const c of colors) {



    for (let l = 1; l <= 4; l++) {



      const alias = `${c}-${l}`;



      const texture = cachedTextures[alias];



      if (!texture) continue;



      



      PIXI.Assets.cache.set(alias, texture);



      



      blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



        if (b.color === c && b.length === l) {



          b.sprite.texture = texture;



        }



      });



    }



  }



}







function updateActiveMaterialUI(activeId: number | null) {



  const slotButtons = document.querySelectorAll('.btn-material-slot');



  slotButtons.forEach(btn => {



    const btnId = btn.getAttribute('data-id');



    if (btnId && parseInt(btnId) === activeId) {



      btn.classList.add('active');



    } else {



      btn.classList.remove('active');



    }



  });



}







function changeMaterialsInOrder() {



  console.log('changeMaterialsInOrder called. preloadedMaterialIds:', preloadedMaterialIds);



  if (preloadedMaterialIds.length === 0) {



    console.log('No preloaded material IDs available; keeping current/default textures.');



    return;



  }







  const packId = preloadedMaterialIds[activeMaterialIndex % preloadedMaterialIds.length];



  activeMaterialIndex++;



  console.log('Selected packId:', packId, 'activeMaterialIndex:', activeMaterialIndex);







  const cachedTextures = preloadedMaterials.get(packId);



  console.log('cachedTextures for packId:', packId, cachedTextures ? 'found' : 'not found');



  if (cachedTextures) {



    applyCachedMaterialPack(cachedTextures);



    localStorage.setItem('activeMaterialId', packId.toString());



    updateActiveMaterialUI(packId);



  }



}







// ---- Step Script Editor Helpers ----



function captureBoardState() {



  initialBoardBlocks = blocks.map(b => ({



    id: b.id,



    col: b.col,



    row: b.row,



    length: b.length,



    color: b.color,



    noGravity: b.noGravity,



    isCollectible: b.isCollectible,



    isProp: b.isProp,



    propType: b.propType,

        propDir: b.propDir



  }));



  initialScrollY = worldContainer.y;



  initialScrollRow = getScrollRowFromWorldY(initialScrollY);



}







function getRainbowFixedColor(row: number): string {



  const rowIndexFromBottom = PARAMS.totalRows - 1 - row;



  return RAINBOW_PALETTE[Math.floor(rowIndexFromBottom / 3) % RAINBOW_PALETTE.length];



}







function initRowColors() {



  rowColors = [];



  for (let r = 0; r < PARAMS.totalRows; r++) {



    rowColors.push(getRainbowFixedColor(r));



  }



}







function applyCurrentTwoColors() {



  if (!isCustomTwoColorMode) return;



  blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



    const newColor = selectedTwoColors[Math.floor(Math.random() * 2)];



    b.color = newColor;



    const texture = PIXI.Assets.get(`${newColor}-${b.length}`);



    if (texture) {



      b.sprite.texture = texture;



    }



  });



}







function resetAndApplyActiveModeStyle() {



  if (isColorChangingMode) {



    const initialPair = COLOR_PAIRS[colorPairIndex];



    blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



      const newColor = initialPair[Math.floor(Math.random() * 2)];



      b.color = newColor;



      const texture = PIXI.Assets.get(`${newColor}-${b.length}`);



      if (texture) {



        b.sprite.texture = texture;



      }



    });



  } else if (isSingleColorMode) {



    singleColorIndex = 0;



    const currentColor = SINGLE_COLORS[0];



    blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



      b.color = currentColor;



      const texture = PIXI.Assets.get(`${currentColor}-${b.length}`);



      if (texture) {



        b.sprite.texture = texture;



      }



    });



    singleColorIndex = 0;



  } else if (isCustomTwoColorMode) {



    applyCurrentTwoColors();



  } else if (isRainbowMode) {



    if (blocks.length > 0) {



      const minRow = blocks.reduce((m, b) => Math.min(m, b.row), Infinity);



      blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



        const color = RAINBOW_PALETTE[Math.floor((b.row - minRow) / 3) % RAINBOW_PALETTE.length];



        b.color = color;



        const tex = PIXI.Assets.get(`${color}-${b.length}`);



        if (tex) {



          b.sprite.texture = tex;



        }



      });



    }



  } else if (isRainbowFixedMode) {



    initRowColors();



    blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



      const color = rowColors[b.row];



      b.color = color;



      const tex = PIXI.Assets.get(`${color}-${b.length}`);



      if (tex) {



        b.sprite.texture = tex;



      }



    });



  } else if (isMaterialChangingMode) {



    activeMaterialIndex = 0;



    if (preloadedMaterialIds.length > 0) {



      const packId = preloadedMaterialIds[0];



      const cachedTextures = preloadedMaterials.get(packId);



      if (cachedTextures) {



        applyCachedMaterialPack(cachedTextures);



        localStorage.setItem('activeMaterialId', packId.toString());



        updateActiveMaterialUI(packId);



      }



      activeMaterialIndex = 1;



    }



  } else if (isCollectMode) {



    blocks.forEach(b => {



      if (b.isCollectible) {



        if (b.sprite instanceof PIXI.AnimatedSprite && activeCollectibleTextures && activeCollectibleTextures.length > 0) {



          b.sprite.textures = activeCollectibleTextures;



          b.sprite.play();



        } else if (activeCollectibleTexture) {



          b.sprite.texture = activeCollectibleTexture;



        }



      }



    });



  }







  // Ensure all block tints are cleared



  blocks.forEach(b => {



    if (!b.isCollectible && !b.isProp && b.sprite) {



      b.sprite.tint = 0xffffff;



    }



  });



}







function restoreBoardState() {



  isGameStarted = false;



  const gameOverEl = document.getElementById('game-over-text');



  if (gameOverEl) {



    gameOverEl.style.display = 'none';



  }



  const btnPlay = document.getElementById('btn-play');



  if (btnPlay) {



    setButtonLabel('btn-play', '▶', '开始游戏');



  }



  clearAllBlocks();



  initialBoardBlocks.forEach(ib => {



    spawnBlock(ib.col, ib.row, ib.length, ib.color, ib.id, ib.noGravity, ib.isCollectible, ib.isProp, ib.propType, ib.propDir || 'left');



  });



  // Restore the saved starting board exactly. Mode effects should happen during



  // recorded eliminations, not randomize the initial layout on every replay.



  setWorldY(initialScrollY);







  if (isCollectMode) {



    const inputCollect = document.getElementById('input-collect') as HTMLInputElement | null;



    collectedCount = inputCollect ? (parseInt(inputCollect.value) || 0) : 0;



  } else {



    const inputScore = document.getElementById('input-score') as HTMLInputElement | null;



    const scoreVal = document.getElementById('score-val');



    if (scoreVal && inputScore) {



      scoreVal.innerText = (parseInt(inputScore.value) || 0).toLocaleString();



    }



  }



  updateHeaderUI();



}







function getVisibleBottomRowForWorldY(worldY: number): number {



  return Math.min(



    PARAMS.totalRows - 1,



    Math.max(0, Math.floor((-worldY + getViewportGameHeight() - 1) / PARAMS.cellSize))



  );



}







function getRecordedStepPhysicsMaxRow(step: ScriptStep, worldY: number = getStepScrollY(step)): number {



  const recordedVisibleBottomRow = getVisibleBottomRowForWorldY(worldY);



  const eliminatedMaxRow = getStepFlatEliminatedRows(step).reduce(



    (maxRow, row) => Math.max(maxRow, row),



    recordedVisibleBottomRow



  );



  return Math.min(PARAMS.totalRows - 1, Math.max(recordedVisibleBottomRow, eliminatedMaxRow));



}







function getRuntimeGravityMaxRow(worldY: number = worldContainer?.y || 0): number {



  if (isFallingMode) return PARAMS.totalRows - 1;



  return (isRisingAdvanceActive() || (isNoGravityMode && getActiveBoardAdvanceMode() === 'fixed'))



    ? getVisibleBottomRowForWorldY(worldY)



    : PARAMS.totalRows - 1;



}







function getStepGravityMaxRow(step: ScriptStep): number {



  const recordedVisibleBottomRow = getVisibleBottomRowForWorldY(getStepScrollY(step));







  if (Number.isFinite(step.gravityMaxRow)) {



    const savedMaxRow = Math.min(PARAMS.totalRows - 1, Math.max(0, Math.floor(step.gravityMaxRow!)));



    const recordedMaxRow = getRecordedStepPhysicsMaxRow(step);



    if (savedMaxRow < recordedMaxRow) {



      return recordedMaxRow;



    }



    if (isNoGravityMode) {



      if (savedMaxRow > recordedMaxRow + 1) {



        return recordedMaxRow;



      }



    }



    return savedMaxRow;



  }







  if (isNoGravityMode && scriptPlaybackAdvanceMode !== 'rising') {



    return recordedVisibleBottomRow;



  }







  if (scriptPlaybackAdvanceMode === 'rising') {



    return getVisibleBottomRowForWorldY(worldContainer ? worldContainer.y : getStepScrollY(step));



  }







  if (isNoGravityMode && getActiveBoardAdvanceMode() === 'fixed') {



    return recordedVisibleBottomRow;



  }







  // Legacy scripts did not save their physics boundary. No-gravity and rising



  // recordings settle against the bottom of the recorded viewport.



  if (isNoGravityMode || getActiveBoardAdvanceMode() === 'rising') {



    return recordedVisibleBottomRow;



  }







  return PARAMS.totalRows - 1;



}







function shouldClampStepGravityMaxRow(step: ScriptStep, expectedMaxRow: number): boolean {



  return isNoGravityMode



    && getActiveBoardAdvanceMode() === 'fixed'



    && Number.isFinite(step.gravityMaxRow)



    && step.gravityMaxRow! > expectedMaxRow;



}







function getActivePhysicsMaxRow(): number {



  if (activeSimulatingStepIndex !== null) {



    const step = scriptSteps[activeSimulatingStepIndex];



    if (step) return getStepGravityMaxRow(step);



  }



  return getRuntimeGravityMaxRow();



}







function normalizeEliminatedRows(rows: number[] = []): number[] {



  const normalized = new Set<number>();



  rows.forEach(row => {



    if (!Number.isFinite(row)) return;



    normalized.add(Math.min(PARAMS.totalRows - 1, Math.max(0, Math.floor(row))));



  });



  return [...normalized].sort((a, b) => a - b);



}







function normalizeEliminationWaves(waves: unknown): number[][] {



  if (!Array.isArray(waves)) return [];



  return waves



    .map(wave => normalizeEliminatedRows(Array.isArray(wave) ? wave : []))



    .filter(wave => wave.length > 0);



}







function getStepFlatEliminatedRows(step: ScriptStep): number[] {



  const flatRows = Array.isArray(step.eliminatedRows) ? step.eliminatedRows : [];



  const waveRows = normalizeEliminationWaves(step.eliminationWaves).flat();



  return normalizeEliminatedRows([...flatRows, ...waveRows]);



}







function getStepEliminationEventCount(step: ScriptStep): number {



  const waves = normalizeEliminationWaves(step.eliminationWaves);



  if (waves.length > 0) {



    return waves.reduce((total, wave) => total + wave.length, 0);



  }



  return normalizeEliminatedRows(Array.isArray(step.eliminatedRows) ? step.eliminatedRows : []).length;



}







function hasRepeatedWaveRows(waves: number[][]): boolean {



  const flatRows = waves.flat();



  return flatRows.length !== new Set(flatRows).size;



}







function mergeStepEliminatedRows(stepIndex: number | null, rows: number[]) {



  if (stepIndex === null || rows.length === 0) return;



  const step = scriptSteps[stepIndex];



  if (!step) return;



  step.eliminatedRows = normalizeEliminatedRows([



    ...(Array.isArray(step.eliminatedRows) ? step.eliminatedRows : []),



    ...rows



  ]);



}







function appendStepEliminationWave(stepIndex: number | null, rows: number[]) {



  if (stepIndex === null || rows.length === 0) return;



  const step = scriptSteps[stepIndex];



  if (!step) return;



  const wave = normalizeEliminatedRows(rows);



  if (wave.length === 0) return;



  const waves = normalizeEliminationWaves(step.eliminationWaves);



  waves.push(wave);



  step.eliminationWaves = waves;



  mergeStepEliminatedRows(stepIndex, wave);



}







function getPlaybackAllowedRows(step: ScriptStep): number[] {



  const waves = normalizeEliminationWaves(step.eliminationWaves);



  if (waves.length > 0) return waves[activeEliminationWaveIndex] || [];



  return getStepFlatEliminatedRows(step);



}







function shouldAdvancePlaybackWave(step: ScriptStep): boolean {



  return normalizeEliminationWaves(step.eliminationWaves).length > 0;



}







function scriptNeedsPlaybackRepair(): boolean {



  return scriptSteps.some(step => {



    if (step.blockId === undefined || step.blockId === null) return true;



    if (!Number.isFinite(step.fromCol) || !Number.isFinite(step.row) || !Number.isFinite(step.toCol)) return true;



    if (!Number.isFinite(step.scrollRow)) return true;



    const recordedMaxRow = getRecordedStepPhysicsMaxRow(step);



    if (!Number.isFinite(step.gravityMaxRow)) return true;



    const savedMaxRow = Math.min(PARAMS.totalRows - 1, Math.max(0, Math.floor(step.gravityMaxRow!)));



    if (savedMaxRow < recordedMaxRow) return true;



    return isNoGravityMode && savedMaxRow > recordedMaxRow + 1;



  });



}







function runPhysicsInstant() {



  console.log('runPhysicsInstant started. initial blocks count:', blocks.length);



  let changed = true;



  let safetyCounter = 0;



  while (changed && safetyCounter < 100) {



    changed = false;



    safetyCounter++;



    



    if (isNoGravityMode) resolveNoGravityStates();







    // 1. Gravity fall



    const instantMaxGravityRow = getActivePhysicsMaxRow();



    blocks.sort((a, b) => b.row - a.row); // Bottom blocks first



    let fallCount = 0;



    blocks.forEach(b => {



      let targetRow = b.row;



      if (isNoGravityMode && b.noGravity) return;



      while (targetRow < instantMaxGravityRow) {



        let canDrop = true;



        if (holeMask && holeMask[targetRow + 1]) {



          for (let c = b.col; c < b.col + b.length; c++) {



            if (holeMask[targetRow + 1][c]) { canDrop = false; break; }



          }



        }



        if (canDrop) {



          for (const other of blocks) {



            if (other.id === b.id) continue;



            if (other.row === targetRow + 1) {



              if (b.col < other.col + other.length && b.col + b.length > other.col) { canDrop = false; break; }



            }



          }



        }



        if (canDrop) targetRow++;



        else break;



      }



      if (targetRow !== b.row) {



        b.row = targetRow;



        b.sprite.y = targetRow * PARAMS.cellSize;



        if (isRainbowFixedMode) {



          const newColor = rowColors[targetRow];



          b.color = newColor;



          const texture = PIXI.Assets.get(`${newColor}-${b.length}`);



          if (texture) b.sprite.texture = texture;



        }



        changed = true;



        fallCount++;



      }



    });



    if (fallCount > 0) {



      console.log(`Iteration ${safetyCounter}: ${fallCount} blocks fell.`);



    }







    // Clear draggedBlockId after the first gravity drop in runPhysicsInstant



    draggedBlockId = null;







    // 2. Row elimination check



    const occ = getGridOccupancy();



    const fullRows: number[] = [];







    if (activeSimulatingStepIndex !== null && !isRepairingScript) {



      const step = scriptSteps[activeSimulatingStepIndex];



      const allowed = getPlaybackAllowedRows(step);



      for (let r = 0; r < PARAMS.totalRows; r++) {



        let isFull = true;



        for (let c = 0; c < PARAMS.gridCols; c++) {



          if (occ[r][c] === 0) { isFull = false; break; }



        }



        if (isFull && allowed.includes(r)) fullRows.push(r);



      }



    } else {



      const minVisibleY = -worldContainer.y;



      const minRow = Math.max(0, Math.floor(minVisibleY / PARAMS.cellSize));



      const maxRow = getVisibleBottomRowForWorldY(worldContainer.y);







      for (let r = minRow; r <= maxRow; r++) {



        let isFull = true;



        for (let c = 0; c < PARAMS.gridCols; c++) {



          if (occ[r][c] === 0) { isFull = false; break; }



        }



        if (isFull) fullRows.push(r);



      }







      if (isRepairingScript && activeRepairEliminationBudget !== null) {



        if (activeRepairEliminationBudget <= 0) {



          fullRows.length = 0;



        } else if (fullRows.length > activeRepairEliminationBudget) {



          fullRows.splice(activeRepairEliminationBudget);



        }



      }



    }







    if (fullRows.length > 0) {



      if (isRepairingScript && activeSimulatingStepIndex !== null) {



        appendStepEliminationWave(activeSimulatingStepIndex, fullRows);



        if (activeRepairEliminationBudget !== null) {



          activeRepairEliminationBudget = Math.max(0, activeRepairEliminationBudget - fullRows.length);



        }



      } else if (activeSimulatingStepIndex !== null && shouldAdvancePlaybackWave(scriptSteps[activeSimulatingStepIndex])) {



        activeEliminationWaveIndex++;



      }



      console.log(`Iteration ${safetyCounter}: full rows detected:`, fullRows);



      fullRows.sort((a, b) => a - b).forEach(r => {



        blocks.filter(b => b.row === r).forEach(b => blocksContainer.removeChild(b.sprite));



        blocks = blocks.filter(b => b.row !== r);



        for (let y = r; y > 0; y--) {



          rowColors[y] = rowColors[y - 1];



        }



        rowColors[0] = getRainbowFixedColor(0);



      });



      if (isColorChangingMode) {



        changeColorsInPairs();



      }



      if (isSingleColorMode) {



        changeSingleColor();



      }



      if (isMaterialChangingMode) {



        changeMaterialsInOrder();



      }



      changed = true;



      console.log(`Iteration ${safetyCounter}: after elimination, blocks count:`, blocks.length);



    }



  }



  console.log('runPhysicsInstant finished. final blocks count:', blocks.length);



}







function repairScriptSteps(options: RepairScriptOptions = {}) {



  if (scriptSteps.length === 0) return;



  const preserveStepIdentity = options.preserveStepIdentity === true;



  const preserveExistingEliminations = options.preserveExistingEliminations === true;



  const currentBlocksBackup: BoardBlockState[] = blocks.map(b => ({



    id: b.id,



    col: b.col,



    row: b.row,



    length: b.length,



    color: b.color,



    noGravity: b.noGravity,



    isCollectible: b.isCollectible,



    isProp: b.isProp,



    propType: b.propType,

        propDir: b.propDir



  }));



  const originalY = worldContainer ? worldContainer.y : 0;



  const rowColorsBackup = [...rowColors];



  const colorPairIndexBackup = colorPairIndex;



  const singleColorIndexBackup = singleColorIndex;



  const activeMaterialIndexBackup = activeMaterialIndex;



  



  isRepairingScript = true;







  try {



    clearAllBlocks();



    initialBoardBlocks.forEach(sb => {



      spawnBlock(sb.col, sb.row, sb.length, sb.color, sb.id, sb.noGravity, sb.isCollectible, sb.isProp, sb.propType, sb.propDir || 'left');



    });



    



    for (let i = 0; i < scriptSteps.length; i++) {



      activeSimulatingStepIndex = i;



      const step = scriptSteps[i];



      const hadBlockId = step.blockId !== undefined && step.blockId !== null;



      const hadFromCol = Number.isFinite(step.fromCol);



      const hadRow = Number.isFinite(step.row);



      const hadGravityMaxRow = Number.isFinite(step.gravityMaxRow);



      const existingWaves = normalizeEliminationWaves(step.eliminationWaves);



      const existingEliminatedRows = getStepFlatEliminatedRows(step);



      const existingEliminationEvents = getStepEliminationEventCount(step);



      const hasValidExistingWaves = existingWaves.length > 0 && !hasRepeatedWaveRows(existingWaves);



      const stepWorldY = getStepScrollY(step);



      setWorldY(stepWorldY);







      const expectedGravityMaxRow = isNoGravityMode



        ? getRecordedStepPhysicsMaxRow(step, stepWorldY)



        : getRuntimeGravityMaxRow(worldContainer.y);



      const savedGravityMaxRow = Number.isFinite(step.gravityMaxRow) ? Math.floor(step.gravityMaxRow!) : null;



      const hasLegacyFlatEliminations = existingWaves.length === 0 && existingEliminatedRows.length > 0;



      const useExistingEliminations = preserveExistingEliminations



        && (hasValidExistingWaves || hasLegacyFlatEliminations);



      const hasStaleNoGravityMaxRow = isNoGravityMode



        && savedGravityMaxRow !== null



        && savedGravityMaxRow > expectedGravityMaxRow + 1;



      const hasTooSmallRecordedMaxRow = isNoGravityMode



        && savedGravityMaxRow !== null



        && savedGravityMaxRow < expectedGravityMaxRow;



      const shouldRefreshGravityMaxRow = !hadGravityMaxRow



        || hasStaleNoGravityMaxRow



        || hasTooSmallRecordedMaxRow



        || (!useExistingEliminations && isNoGravityMode && savedGravityMaxRow !== expectedGravityMaxRow)



        || (!useExistingEliminations && shouldClampStepGravityMaxRow(step, expectedGravityMaxRow));



      if (useExistingEliminations) {



        step.eliminationWaves = hasValidExistingWaves ? existingWaves : [];



        step.eliminatedRows = existingEliminatedRows;



      } else {



        step.eliminationWaves = [];



        step.eliminatedRows = [];



      }







      let block = step.blockId ? blocks.find(b => b.id === step.blockId) : null;



      if (!block) {



        block = blocks.find(b => b.row === step.row && b.col === step.fromCol);



      }



      if (!block) {



        console.warn(`[Script repair] Block not found for step ${i + 1}; the damaged legacy step was skipped.`);



        continue;



      }







      if (!preserveStepIdentity || !hadBlockId) step.blockId = block.id;



      if (!preserveStepIdentity || !hadFromCol) step.fromCol = block.col;



      if (!preserveStepIdentity || !hadRow) step.row = block.row;



      if (shouldRefreshGravityMaxRow) step.gravityMaxRow = expectedGravityMaxRow;







      if (!canMoveBlockHorizontallyTo(block, step.toCol)) {



        console.warn(`[Script repair] Step ${i + 1} target column ${step.toCol} is occupied; the damaged legacy step was skipped.`);



        continue;



      }







      block.col = step.toCol;



      block.sprite.x = step.toCol * PARAMS.cellSize;



      block.noGravity = false;



      releaseVisibleNoGravityBlocks(stepWorldY, getStepGravityMaxRow(step));



      draggedBlockId = block.id;



      const previousRepairFlag: boolean = isRepairingScript;



      const previousRepairEliminationBudget = activeRepairEliminationBudget;



      const previousWaveIndex = activeEliminationWaveIndex;



      isRepairingScript = !useExistingEliminations;



      activeRepairEliminationBudget = !useExistingEliminations && existingEliminationEvents > 0



        ? existingEliminationEvents



        : null;



      activeEliminationWaveIndex = 0;



      try {



        runPhysicsInstant();



      } finally {



        isRepairingScript = previousRepairFlag;



        activeRepairEliminationBudget = previousRepairEliminationBudget;



        activeEliminationWaveIndex = previousWaveIndex;



      }



    }



  } finally {



    activeSimulatingStepIndex = null;



    activeEliminationWaveIndex = 0;



    activeRepairEliminationBudget = null;



    isRepairingScript = false;







    clearAllBlocks();



    currentBlocksBackup.forEach(cb => {



      spawnBlock(cb.col, cb.row, cb.length, cb.color, cb.id, cb.noGravity, cb.isCollectible, cb.isProp, cb.propType, cb.propDir || 'left');



    });







    rowColors = rowColorsBackup;



    colorPairIndex = colorPairIndexBackup;



    singleColorIndex = singleColorIndexBackup;



    activeMaterialIndex = activeMaterialIndexBackup;



    draggedBlockId = null;



    blocksThatFell.clear();



    setWorldY(originalY);



  }



}







function jumpToStepState(stepIndex: number) {



  restoreBoardState();



  selectedStepIndex = stepIndex;







  // Execute all steps up to stepIndex-1 instantly



  for (let i = 0; i < stepIndex; i++) {



    activeSimulatingStepIndex = i;



    activeEliminationWaveIndex = 0;



    const step = scriptSteps[i];



    if (worldContainer) {



      setWorldY(getStepScrollY(step));



    }



    let block = step.blockId ? blocks.find(b => b.id === step.blockId) : null;



    if (!block) {



      block = blocks.find(b => b.col === step.fromCol && b.row === step.row);



    }



    if (!block) {



      console.warn(`[Step jump] Block not found for step ${i + 1}.`);



      continue;



    }



    if (!canMoveBlockHorizontallyTo(block, step.toCol)) {



      console.warn(`[Step jump] Step ${i + 1} target column ${step.toCol} is occupied.`);



      continue;



    }



    block.col = step.toCol;



    block.sprite.x = step.toCol * PARAMS.cellSize;



    block.noGravity = false;



    releaseVisibleNoGravityBlocks(getStepScrollY(step), getStepGravityMaxRow(step));



    draggedBlockId = block.id;



    runPhysicsInstant();



  }



  activeSimulatingStepIndex = null;



  activeEliminationWaveIndex = 0;







  // Align the viewport to the selected step's scrollY'



  if (stepIndex < scriptSteps.length) {



    const nextStep = scriptSteps[stepIndex];



    if (nextStep) {



      setWorldY(getStepScrollY(nextStep));



    } else {



      setWorldY(initialScrollY);



    }



  } else {



    if (scriptSteps.length > 0) {



      const lastStep = scriptSteps[scriptSteps.length - 1];



      if (lastStep) {



        setWorldY(getStepScrollY(lastStep));



      } else {



        setWorldY(initialScrollY);



      }



    } else {



      setWorldY(initialScrollY);



    }



  }







  highlightStepUI(stepIndex);



}







function highlightStepUI(stepIndex: number | null) {



  const items = document.querySelectorAll('#script-step-list .material-slot-row');



  items.forEach((item, idx) => {



    const btn = item.querySelector('.btn-material-slot');



    if (btn) {



      if (idx === stepIndex) {



        btn.classList.add('active');



      } else {



        btn.classList.remove('active');



      }



    }



  });



}







function updateScriptUI() {



  const container = document.getElementById('script-step-list')!;



  container.innerHTML = '';



  scriptSteps.forEach((step, idx) => {



    const rowDiv = document.createElement('div');



    rowDiv.className = 'material-slot-row';



    rowDiv.style.display = 'flex';



    rowDiv.style.gap = '6px';



    rowDiv.style.alignItems = 'center';



    



    const btn = document.createElement('button');



    btn.className = 'btn-material-slot';



    if (idx === selectedStepIndex) {



      btn.classList.add('active');



    }



    btn.innerHTML = `<span>步骤 ${idx + 1}：行 ${step.row}（列 ${step.fromCol} ➔ ${step.toCol}）</span>`;



    btn.onclick = () => {



      if (isPlayingScript) return;



      jumpToStepState(idx);



    };



    



    const btnDel = document.createElement('button');



    btnDel.className = 'btn-material-clear';



    btnDel.textContent = '🗑';



    btnDel.title = `删除步骤 ${idx + 1}`;



    btnDel.setAttribute('aria-label', `删除步骤 ${idx + 1}`);



    btnDel.onclick = (e) => {



      e.stopPropagation();



      if (isPlayingScript) return;



      scriptSteps.splice(idx, 1);



      repairScriptSteps();



      selectedStepIndex = null;



      updateScriptUI();



      restoreBoardState();



    };



    



    rowDiv.appendChild(btn);



    rowDiv.appendChild(btnDel);



    container.appendChild(rowDiv);



  });



  repairChineseUI();



}







function waitForPhysics(): Promise<void> {



  return new Promise<void>((resolve) => {



    const check = () => {



      if (!isAnimating) {



        resolve();



      } else {



        requestAnimationFrame(check);



      }



    };



    setTimeout(check, 80);



  });



}







function waitForScriptPlaybackDelay(durationMs: number): Promise<void> {



  return new Promise<void>((resolve) => {



    const startedAt = performance.now();



    const check = () => {



      const remaining = durationMs - (performance.now() - startedAt);



      if (remaining <= 0 || scriptPlaybackStopRequested) {



        resolve();



        return;



      }



      window.setTimeout(check, Math.min(50, remaining));



    };



    check();



  });



}







function getInitialScriptPauseMs() {



  const pauseControl = document.getElementById('input-script-initial-pause') as HTMLInputElement | HTMLSelectElement | null;



  if (!pauseControl) return 0;



  if (pauseControl instanceof HTMLSelectElement) {



    const seconds = Number(pauseControl.value);



    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;



  }



  return pauseControl.checked ? 2000 : 0;



}







function animateRecordedScrollTo(targetY: number, durationMs: number): Promise<void> {



  if (!Number.isFinite(targetY)) return waitForScriptPlaybackDelay(durationMs);



  const token = ++recordedScrollAnimationToken;



  if (durationMs <= 0) {



    setWorldY(targetY);



    return Promise.resolve();



  }







  return new Promise<void>((resolve) => {



    const startY = worldContainer ? worldContainer.y : virtualScrollY;



    const startedAt = performance.now();



    const tick = () => {



      if (scriptPlaybackStopRequested || token !== recordedScrollAnimationToken) {



        resolve();



        return;



      }



      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);



      setWorldY(startY + (targetY - startY) * progress);



      if (progress >= 1) {



        resolve();



      } else {



        requestAnimationFrame(tick);



      }



    };



    tick();



  });



}







function getRecordedScrollDurationMs(fromY: number, toY: number, minimumMs = 0): number {



  if (!Number.isFinite(fromY) || !Number.isFinite(toY)) {



    return Math.max(0, minimumMs);



  }



  const speedPxPerSec = Math.max(1, Number(PARAMS.scrollSpeed) || 1);



  const distancePx = Math.abs(toY - fromY);



  return Math.max(minimumMs, (distancePx / speedPxPerSec) * 1000);



}







async function playScript(autoScroll = false, rising = false, options: PlayScriptOptions = {}) {



  if (isPlayingScript) return;



  if (scriptSteps.length === 0) {



    alert('当前演示剧本为空，请先录制步骤或读取已有剧本');



    return;



  }



  isPlayingScript = true;



  scriptPlaybackStopRequested = false;



  scriptPlaybackAdvanceMode = autoScroll ? 'scroll' : (rising ? 'rising' : 'fixed');



  syncBoardAdvanceFlags(scriptPlaybackAdvanceMode);







  const btnPlay = document.getElementById('btn-script-play');



  const btnPlayRising = document.getElementById('btn-script-rising-play');



  const btnPlayScroll = document.getElementById('btn-script-play-scroll');



  if (btnPlay) btnPlay.innerText = '⏸ 暂停播放';



  if (btnPlayRising) btnPlayRising.innerText = '⏸ 暂停播放';



  if (btnPlayScroll) btnPlayScroll.innerText = '⏸ 暂停播放';







  const durInput = document.getElementById('input-script-duration') as HTMLInputElement;



  const slideDelayInput = document.getElementById('input-script-delay-slide') as HTMLInputElement;



  const stepDelayInput = document.getElementById('input-script-delay-step') as HTMLInputElement;







  const duration = parseFloat(durInput.value) || 0.3;



  const slideDelay = parseFloat(slideDelayInput.value) || 0.15;



  const stepDelay = parseFloat(stepDelayInput.value) || 0.5;



  const initialPauseMs = getInitialScriptPauseMs();



  const useRecordedScrollTrack = !autoScroll && !rising && hasMeaningfulRecordedScrollTrack();



  const shouldAlignToStepScroll = useRecordedScrollTrack || (!autoScroll && !rising);



  const shouldAlignEachStepScroll = shouldAlignToStepScroll && !(autoScroll && useRecordedScrollTrack);







  // A recording can be stopped while its final gravity chain is still running.



  // Never restore or replay over that unfinished animation.



  await waitForPhysics();



  if (initialBoardBlocks.length > 0 && scriptNeedsPlaybackRepair()) {



    repairScriptSteps({



      preserveStepIdentity: true,



      preserveExistingEliminations: true



    });



    updateScriptUI();



  }



  isGameStarted = false;



  stopGameplayModeTimer();



  stopWorldAdvanceTweens(true);



  setButtonLabel('btn-play', '▶', '开始游戏');







  let startIdx = 0;



  const isResuming = options.resumeFromSelected === true



    && selectedStepIndex !== null



    && selectedStepIndex < scriptSteps.length;



  if (isResuming) {



    startIdx = selectedStepIndex!;



    if (getBlockOverlapPairs().length > 0) {



      jumpToStepState(startIdx);



    }



  } else {



    restoreBoardState();



    comboCount = 0;



    hasAnyEliminationThisStep = false;



  }



  if (shouldAlignToStepScroll && scriptSteps[startIdx]) {



    setWorldY(getStepScrollY(scriptSteps[startIdx]));



  }



  



  const startAutoScroll = () => {



    if (!autoScroll || scriptPlaybackStopRequested) return;



    isGameStarted = true;



    gameTime = 0;



  };







  // The optional pause only delays scripted block movement. Continuous board



  // scrolling still starts immediately so the opening two seconds stay alive.



  startAutoScroll();



  await waitForScriptPlaybackDelay(initialPauseMs || (autoScroll && useRecordedScrollTrack ? 0 : 100));







  let nextStepIndex = startIdx;



  let blockedStepIndex: number | null = null;







  for (let i = startIdx; i < scriptSteps.length; i++) {



    if (scriptPlaybackStopRequested) break;







    selectedStepIndex = i;



    activeSimulatingStepIndex = i;



    activeEliminationWaveIndex = 0;



    highlightStepUI(i);







    const step = scriptSteps[i];



    const nextStep = scriptSteps[i + 1];



    if (shouldAlignEachStepScroll) {



      setWorldY(getStepScrollY(step));



    }



    let block = step.blockId ? blocks.find(b => b.id === step.blockId) : null;



    if (!block) {



      block = blocks.find(b => b.col === step.fromCol && b.row === step.row);



    }



    if (!block) {



      console.warn(`[Playback] Block not found at (${step.fromCol}, ${step.row}) for step ${i + 1}`);



      nextStepIndex = i + 1;



      continue;



    }







    if (!canMoveBlockHorizontallyTo(block, step.toCol)) {



      console.warn(`[Playback] Step ${i + 1} target column ${step.toCol} is occupied; damaged legacy step skipped before overlap.`);



      nextStepIndex = i + 1;



      continue;



    }







    const stepStateBefore: BoardBlockState[] = blocks.map(b => ({



      id: b.id,



      col: b.col,



      row: b.row,



      length: b.length,



      color: b.color,



      noGravity: b.noGravity,



      isCollectible: b.isCollectible,



      isProp: b.isProp,



      propType: b.propType,

        propDir: b.propDir



    }));



    const stepWorldYBefore = worldContainer.y;







    // In recorded scrolling playback, the viewport should start moving as soon



    // as the step starts. Physics below still uses the recorded step boundary,



    // so the moving camera cannot change which rows are allowed to clear.



    if (autoScroll && useRecordedScrollTrack && nextStep && !scriptPlaybackStopRequested) {



      const targetY = getStepScrollY(nextStep);



      const sourceY = worldContainer ? worldContainer.y : getStepScrollY(step);



      const scrollDurationMs = getRecordedScrollDurationMs(



        sourceY,



        targetY,



        Math.max(0, stepDelay) * 1000



      );



      void animateRecordedScrollTo(targetY, scrollDurationMs);



    }







    // 1. Move/slide the block. A pause request is handled only after this



    // complete move + gravity transaction, never in the middle of a step.



    isPlayingStepTransition = true;



    await new Promise<void>((resolve) => {



      isAnimating = true;



      const brightFilter = new PIXI.ColorMatrixFilter();



      brightFilter.brightness(2.8, false);



      block.sprite.filters = [brightFilter];







      playSound(sounds.spawn);







      gsap.to(block.sprite, {



        x: step.toCol * PARAMS.cellSize,



        duration: duration,



        ease: 'power1.inOut',



        onComplete: () => {



          block.col = step.toCol;



          block.sprite.filters = [];



          isAnimating = false;



          resolve();



        }



      });



    });







    // 2. Preserve the visual pause when playing normally, but finish a



    // requested pause promptly so the board cannot remain half-settled.



    if (slideDelay > 0 && !scriptPlaybackStopRequested) {



      await new Promise(r => setTimeout(r, slideDelay * 1000));



    }







    // 3. Apply the same physics boundary and no-gravity viewport that were



    // present when this step was recorded.



    hasAnyEliminationThisStep = false;

    risingEliminationWavesThisMove = 0;



    block.noGravity = false;



    const recordedStepWorldY = getStepScrollY(step);



    releaseVisibleNoGravityBlocks(recordedStepWorldY, getStepGravityMaxRow(step));



    draggedBlockId = block.id;

    if (isRisingAdvanceActive()) {
      pendingRisingRows = getRisingRowsForCompletedMove(risingEliminationWavesThisMove);
    }



    blocksThatFell.clear();



    blocksThatFell.add(block.id);







    applyGravity(true);



    await waitForPhysics();



    isPlayingStepTransition = false;







    const overlaps = getBlockOverlapPairs();



    if (overlaps.length > 0) {



      console.error(`[Playback] Step ${i + 1} produced overlapping blocks; the step was rolled back.`, overlaps);



      clearAllBlocks();



      stepStateBefore.forEach(sb => {



        spawnBlock(sb.col, sb.row, sb.length, sb.color, sb.id, sb.noGravity, sb.isCollectible, sb.isProp, sb.propType, sb.propDir || 'left');



      });



      setWorldY(stepWorldYBefore);



      blockedStepIndex = i;



      break;



    }







    nextStepIndex = i + 1;



    if (scriptPlaybackStopRequested) break;







    // 4. Pause between completed steps. In recorded scrolling autoplay, the



    // camera is already moving independently, so do not let scroll distance



    // stretch the script timing.



    if (i < scriptSteps.length - 1) {



      if (useRecordedScrollTrack && nextStep && !scriptPlaybackStopRequested) {



        if (autoScroll) {



          if (stepDelay > 0) {



            await waitForScriptPlaybackDelay(stepDelay * 1000);



          }



        } else {



          await animateRecordedScrollTo(getStepScrollY(nextStep), Math.max(0, stepDelay) * 1000);



        }



      } else if (stepDelay > 0) {



        await waitForScriptPlaybackDelay(stepDelay * 1000);



      }



    }



  }







  activeSimulatingStepIndex = null;



  activeEliminationWaveIndex = 0;



  recordedScrollAnimationToken++;



  isPlayingScript = false;



  isPlayingStepTransition = false;



  if (blockedStepIndex !== null) {



    selectedStepIndex = blockedStepIndex;



    highlightStepUI(blockedStepIndex);



  } else if (nextStepIndex < scriptSteps.length) {



    selectedStepIndex = nextStepIndex;



    highlightStepUI(nextStepIndex);



  } else {



    selectedStepIndex = null;



    highlightStepUI(null);



  }



  isGameStarted = false;



  if (scriptPlaybackAdvanceMode === 'scroll') {



    snapWorldYToGrid();



  }



  setButtonLabel('btn-play', '▶', '开始游戏');



  scriptPlaybackAdvanceMode = null;



  scriptPlaybackStopRequested = false;



  syncBoardAdvanceFlags(boardAdvanceMode);



  if (btnPlay) btnPlay.innerText = '▶ 自动播放';



  if (btnPlayRising) btnPlayRising.innerText = '▶ 自动播放 (上升)';



  if (btnPlayScroll) btnPlayScroll.innerText = '▶ 自动播放 (滚动)';







  // Clear any leftover filters



  blocks.forEach(b => {



    if (b.sprite) b.sprite.filters = [];



  });



}







async function playScriptFromButton(autoScroll = false, rising = false) {
  await playScript(autoScroll, rising);



}











function generateGameplayRow(row: number) {



  const occupied = Array(PARAMS.gridCols).fill(false);



  const targetWidth = Math.floor(Math.random() * 2) + 7; // fill 7 or 8 columns



  let filledWidth = 0;



  let retries = 0;



  const colors = ['red', 'blue', 'green', 'yellow', 'pink'];



  



  while (filledWidth < targetWidth && retries < 30) {



    retries++;



    const len = weightedRandomLength(Math.min(4, PARAMS.gridCols - filledWidth));



    if (len <= 0) continue;



    



    const freeCols: number[] = [];



    for (let c = 0; c <= PARAMS.gridCols - len; c++) {



      let isFree = true;



      for (let i = 0; i < len; i++) {



        if (occupied[c + i]) { isFree = false; break; }



      }



      if (isFree) freeCols.push(c);



    }



    if (freeCols.length === 0) continue;



    const startCol = freeCols[Math.floor(Math.random() * freeCols.length)];



    



    for (let i = 0; i < len; i++) occupied[startCol + i] = true;



    filledWidth += len;



    



    let color: string;



    if (isCustomTwoColorMode) {



      color = selectedTwoColors[Math.floor(Math.random() * 2)];



    } else if (isColorChangingMode) {



      const pair = COLOR_PAIRS[colorPairIndex % COLOR_PAIRS.length];



      color = pair[Math.floor(Math.random() * 2)];



    } else if (isSingleColorMode) {



      color = SINGLE_COLORS[singleColorIndex % SINGLE_COLORS.length];



    } else if (isRainbowFixedMode) {



      color = rowColors[row];



    } else {



      color = colors[randomInt(0, colors.length - 1)];



    }



    const isCollectibleBlock = isCollectMode && len === 1 && Math.random() < 0.3;



    spawnBlock(startCol, row, len, color, undefined, undefined, isCollectibleBlock);



  }



}







function initGameplayModeBoard() {



  clearAllBlocks();



  if (isColorChangingMode) { /* keep current colorPairIndex */ }



  if (isSingleColorMode) singleColorIndex = 0;



  if (isCollectMode) {



    collectedCount = 0;



    updateHeaderUI();



  }



  const startRow = PARAMS.viewportRows - 4;



  for (let r = startRow; r < PARAMS.viewportRows; r++) {



    generateGameplayRow(r);



  }



  preventFullRows();



  applyGravity(false);



}







function spawnRisingRow() {



  if (isAnimating) return; // Skip if busy animating



  hasAnyEliminationThisStep = false;



  



  // 1. Shift all blocks up



  blocks.forEach(b => {



    b.row -= 1;



    b.sprite.y = b.row * PARAMS.cellSize;



  });



  



  for (let y = 0; y < PARAMS.totalRows - 1; y++) {



    rowColors[y] = rowColors[y + 1];



  }



  rowColors[PARAMS.totalRows - 1] = getRainbowFixedColor(PARAMS.totalRows - 1);



  



  // Proactive check



  const reachedTop = blocks.some(b => b.row < 0);



  if (reachedTop) {



    triggerGameplayGameOver();



    return;



  }



  



  // 2. Spawn new row at bottom



  const bottomRow = PARAMS.totalRows - 1;



  spawnFallingSupplyRow(bottomRow);



  



  playSound(sounds.spawn);



  applyGravity(true);



}







function resetGameplayTimer() {



  if (!isGameplayMode || !isGameStarted) return;



  if (gameplayTimer) clearInterval(gameplayTimer);



  gameplayTimer = setInterval(() => {



    spawnRisingRow();



  }, gameplayRiseInterval);



}







function stopGameplayModeTimer() {



  isGameplayMode = false;



  if (gameplayTimer) {



    clearInterval(gameplayTimer);



    gameplayTimer = null;



  }



}







function triggerGameOver(reason = 'unknown') {



  isGameStarted = false;



  if (isPlayingScript) {



    scriptPlaybackStopRequested = true;



  }



  setButtonLabel('btn-play', '▶', '开始游戏');



  console.warn('[GameOver]', reason, {



    gameTime,



    worldY: worldContainer?.y,



    mode: getActiveBoardAdvanceMode(),



    isGameplayMode,



    isFallingMode,



    isFixedBoardMode,



    blocks: blocks.length



  });



  const gameOverEl = document.getElementById('game-over-text')!;



  gameOverEl.style.display = 'none';

  showFailureImpact();

  if (isStandalonePlayable) {
    window.setTimeout(() => {
      (window as any).triggerPlayableCTA();
    }, 800);
    return;
  }

  gameOverEl.title = reason;



  if (gameplayTimer) {



    clearInterval(gameplayTimer);



    gameplayTimer = null;



  }



  



  setTimeout(() => {



    document.getElementById('game-over-text')!.style.display = 'none';
    hideFailureImpact();



    if (isGameplayMode) {



      initGameplayModeBoard();



      isGameStarted = true;



      resetGameplayTimer();



    } else {



      restoreBoardState();



    }



  }, 3000);



}







function triggerVictory() {



  isGameStarted = false;



  setButtonLabel('btn-play', '▶', '开始游戏');



  const gameOverEl = document.getElementById('game-over-text')!;



  gameOverEl.style.display = 'none';



  



  if (gameplayTimer) {



    clearInterval(gameplayTimer);



    gameplayTimer = null;



  }



  



  setTimeout(() => {



    gameOverEl.innerText = 'GAME OVER';



    gameOverEl.style.color = '#ff3366';



    gameOverEl.style.textShadow = '0 0 20px rgba(255, 51, 102, 0.5)';



    restoreBoardState();



  }, 3000);



}







function triggerGameplayGameOver() {



  if (!isGameplayMode && !isGameStarted) return;



  triggerGameOver('gameplay-rising-row');



}







async function addNewMaterial() {



  const name = prompt('请输入新建材质包的名称：');



  if (name === null) return; // User cancelled



  const cleanName = name.trim() || `材质包_${new Date().toLocaleTimeString()}`;



  try {



    await materialDB.addMaterial(cleanName);



    await renderMaterialList();



  } catch (err) {



    console.error(err);



    alert('新建材质包失败！');



  }



}







async function addNewSound() {



  const name = prompt('请输入新建音效包的名称：');



  if (name === null) return; // User cancelled



  const cleanName = name.trim() || `音效包_${new Date().toLocaleTimeString()}`;



  try {



    await soundDB.addSound(cleanName);



    await renderSoundList();



  } catch (err) {



    console.error(err);



    alert('新建音效包失败！');



  }



}







const MATERIAL_COLOR_NAMES: Record<string, string> = {

  red: 'red', blue: 'blue', green: 'green', yellow: 'yellow', pink: 'pink',

  '红': 'red', '红色': 'red',

  '蓝': 'blue', '蓝色': 'blue',

  '绿': 'green', '绿色': 'green',

  '黄': 'yellow', '黄色': 'yellow',

  '粉': 'pink', '粉色': 'pink'

};







function parseMaterialTextureName(fileName: string): { color: string; length: number } | null {

  const baseName = fileName.replace(/\.(png|jpe?g|webp)$/i, '');

  // 双字中文放在单字前面，防止正则匹配到单字后提前停止（如"红色"被"红"截断）

  const colorPattern = '(red|blue|green|yellow|pink|红色|蓝色|绿色|黄色|粉色|红|蓝|绿|黄|粉)';

  const standardMatch = baseName.match(new RegExp(`^${colorPattern}[\s_\-]*([1-4])$`, 'i'));

  const legacyMatch = baseName.match(new RegExp(`^${colorPattern}1[^\dA-Za-z\u4e00-\u9fff]+([1-4])$`, 'i'));

  const match = standardMatch || legacyMatch;

  if (!match) return null;

  const rawColor = match[1].toLowerCase();

  const color = MATERIAL_COLOR_NAMES[rawColor] || rawColor;

  const length = parseInt(match[2], 10);

  if (isNaN(length) || length < 1 || length > 4) return null;

  return { color, length };

}









// ---- 材质手动映射对话框 ----

// 当文件名无法自动识别时，展示此对话框让用户手动将图片分配到对应颜色+格数的槽位

async function showMaterialMapperDialog(files: File[]): Promise<Record<string, string> | null> {

  const COLORS = [

    { key: 'red', label: '红色', dot: '#e05050' },

    { key: 'blue', label: '蓝色', dot: '#5080e0' },

    { key: 'green', label: '绿色', dot: '#50c050' },

    { key: 'yellow', label: '黄色', dot: '#e0c040' },

    { key: 'pink', label: '粉色', dot: '#e060a0' },

  ];

  const LENGTHS = [1, 2, 3, 4];



  // 只保留图片类型文件

  const imgFiles = files.filter(f => /\.(png|jpe?g|webp)$/i.test(f.name));

  if (imgFiles.length === 0) return null;



  // 预先生成 object URL

  const fileUrls = imgFiles.map(f => ({ file: f, url: URL.createObjectURL(f) }));



  return new Promise<Record<string, string> | null>((resolve) => {

    // slot map: key = "color-length", value = index into fileUrls

    const slotMap: Record<string, number> = {};

    // reverse: fileIdx -> slotKey

    const fileSlotMap: Record<number, string> = {};

    let selectedFileIdx: number | null = null;



    const overlay = document.createElement('div');

    overlay.id = 'material-mapper-overlay';



    const dialog = document.createElement('div');

    dialog.id = 'material-mapper-dialog';



    // Header

    const header = document.createElement('h3');

    header.innerHTML = '手动分配材质图片 <span>选中左侧图片，然后点击右侧对应槽位</span>';

    dialog.appendChild(header);



    // Body

    const body = document.createElement('div');

    body.className = 'mapper-body';



    // === 左侧文件面板 ===

    const filesPanel = document.createElement('div');

    filesPanel.className = 'mapper-files-panel';

    const filesPanelTitle = document.createElement('h4');

    filesPanelTitle.textContent = `图片文件 (${imgFiles.length})`;

    filesPanel.appendChild(filesPanelTitle);



    const thumbEls: HTMLElement[] = [];



    fileUrls.forEach(({ file, url }, idx) => {

      const thumb = document.createElement('div');

      thumb.className = 'mapper-file-thumb';



      const img = document.createElement('img');

      img.src = url;



      const name = document.createElement('div');

      name.className = 'mapper-file-thumb-name';

      name.title = file.name;

      name.textContent = file.name;



      const badge = document.createElement('div');

      badge.className = 'mapper-file-thumb-badge';

      badge.style.display = 'none';



      thumb.appendChild(img);

      thumb.appendChild(name);

      thumb.appendChild(badge);

      thumbEls.push(thumb);



      thumb.onclick = () => {

        // 选中该文件

        thumbEls.forEach(t => t.classList.remove('selected'));

        thumb.classList.add('selected');

        selectedFileIdx = idx;

        // 高亮已分配的槽位

        refreshSlots();

      };



      filesPanel.appendChild(thumb);

    });



    // === 右侧槽位面板 ===

    const slotsPanel = document.createElement('div');

    slotsPanel.className = 'mapper-slots-panel';

    const slotsPanelTitle = document.createElement('h4');

    slotsPanelTitle.textContent = '颜色 × 格数 槽位';

    slotsPanel.appendChild(slotsPanelTitle);

    const hint = document.createElement('div');

    hint.className = 'mapper-slot-hint';

    hint.textContent = '先在左侧选一张图，再点击右侧空槽位完成分配。点击已分配槽位右上角 × 可清除。';

    slotsPanel.appendChild(hint);



    const grid = document.createElement('div');

    grid.className = 'mapper-grid';



    // 表头

    const emptyHeader = document.createElement('div');

    emptyHeader.className = 'mapper-grid-header';

    emptyHeader.textContent = '';

    grid.appendChild(emptyHeader);

    LENGTHS.forEach(len => {

      const h = document.createElement('div');

      h.className = 'mapper-grid-header';

      h.textContent = `${len} 格`;

      grid.appendChild(h);

    });



    const slotEls: Record<string, HTMLElement> = {};



    COLORS.forEach(({ key, label, dot }) => {

      const colorLabel = document.createElement('div');

      colorLabel.className = 'mapper-color-label';

      const dotEl = document.createElement('div');

      dotEl.className = 'mapper-color-dot';

      dotEl.style.background = dot;

      colorLabel.appendChild(dotEl);

      colorLabel.appendChild(document.createTextNode(label));

      grid.appendChild(colorLabel);



      LENGTHS.forEach(len => {

        const slotKey = `${key}-${len}`;

        const slot = document.createElement('div');

        slot.className = 'mapper-slot';



        const emptyText = document.createElement('div');

        emptyText.className = 'mapper-slot-empty-text';

        emptyText.textContent = '点击分配';

        slot.appendChild(emptyText);



        const clearBtn = document.createElement('button');

        clearBtn.className = 'mapper-slot-clear';

        clearBtn.textContent = '×';

        clearBtn.onclick = (e) => {

          e.stopPropagation();

          const prevIdx = slotMap[slotKey];

          if (prevIdx !== undefined) {

            delete fileSlotMap[prevIdx];

            delete slotMap[slotKey];

            thumbEls[prevIdx].classList.remove('assigned');

            const badge = thumbEls[prevIdx].querySelector('.mapper-file-thumb-badge') as HTMLElement;

            if (badge) badge.style.display = 'none';

          }

          refreshSlots();

          refreshFooter();

        };

        slot.appendChild(clearBtn);



        slot.onclick = () => {

          if (selectedFileIdx === null) {

            hint.textContent = '⚠️ 请先在左侧选择一张图片！';

            return;

          }

          // 清除该文件之前占的槽

          const prevSlot = fileSlotMap[selectedFileIdx];

          if (prevSlot && prevSlot !== slotKey) {

            delete slotMap[prevSlot];

            if (slotEls[prevSlot]) refreshOneSlot(prevSlot);

          }

          // 清除该槽之前分配的文件

          const prevFileIdx = slotMap[slotKey];

          if (prevFileIdx !== undefined && prevFileIdx !== selectedFileIdx) {

            delete fileSlotMap[prevFileIdx];

            thumbEls[prevFileIdx].classList.remove('assigned');

            const b = thumbEls[prevFileIdx].querySelector('.mapper-file-thumb-badge') as HTMLElement;

            if (b) b.style.display = 'none';

          }

          // 分配

          slotMap[slotKey] = selectedFileIdx;

          fileSlotMap[selectedFileIdx] = slotKey;

          thumbEls[selectedFileIdx].classList.add('assigned');

          const badge = thumbEls[selectedFileIdx].querySelector('.mapper-file-thumb-badge') as HTMLElement;

          if (badge) { badge.textContent = `${label} ${len}格`; badge.style.display = ''; }

          refreshSlots();

          refreshFooter();

        };



        slotEls[slotKey] = slot;

        grid.appendChild(slot);

      });

    });



    slotsPanel.appendChild(grid);

    body.appendChild(filesPanel);

    body.appendChild(slotsPanel);

    dialog.appendChild(body);



    // === 底部 ===

    const footer = document.createElement('div');

    footer.className = 'mapper-footer';

    const progress = document.createElement('div');

    progress.className = 'mapper-progress';

    const cancelBtn = document.createElement('button');

    cancelBtn.className = 'mapper-btn mapper-btn-cancel';

    cancelBtn.textContent = '取消';

    cancelBtn.onclick = () => {

      fileUrls.forEach(({ url }) => URL.revokeObjectURL(url));

      overlay.remove();

      resolve(null);

    };

    const confirmBtn = document.createElement('button');

    confirmBtn.className = 'mapper-btn mapper-btn-confirm';

    confirmBtn.textContent = '确认导入';

    confirmBtn.disabled = true;

    confirmBtn.onclick = async () => {

      const textures: Record<string, string> = {};

      for (const [slotKey, fileIdx] of Object.entries(slotMap)) {

        textures[slotKey] = await fileToBase64(fileUrls[fileIdx].file);

      }

      fileUrls.forEach(({ url }) => URL.revokeObjectURL(url));

      overlay.remove();

      resolve(textures);

    };

    footer.appendChild(progress);

    footer.appendChild(cancelBtn);

    footer.appendChild(confirmBtn);

    dialog.appendChild(footer);



    overlay.appendChild(dialog);

    document.body.appendChild(overlay);



    // 初始化渲染

    refreshSlots();

    refreshFooter();



    function refreshOneSlot(slotKey: string) {

      const slot = slotEls[slotKey];

      if (!slot) return;

      const assignedIdx = slotMap[slotKey];

      slot.className = 'mapper-slot';

      // 清除旧内容（保留 clearBtn）

      const clearBtn = slot.querySelector('.mapper-slot-clear');

      slot.innerHTML = '';

      if (clearBtn) slot.appendChild(clearBtn);

      if (assignedIdx !== undefined) {

        slot.classList.add('ready');

        const img = document.createElement('img');

        img.src = fileUrls[assignedIdx].url;

        slot.appendChild(img);

      } else {

        if (selectedFileIdx !== null && !fileSlotMap[selectedFileIdx]) {

          slot.classList.add('targeted');

        }

        const emptyText = document.createElement('div');

        emptyText.className = 'mapper-slot-empty-text';

        emptyText.textContent = selectedFileIdx !== null ? '点击分配' : '—';

        slot.appendChild(emptyText);

      }

    }



    function refreshSlots() {

      Object.keys(slotEls).forEach(k => refreshOneSlot(k));

    }



    function refreshFooter() {

      const totalRequired = 20;

      const filled = Object.keys(slotMap).length;

      progress.innerHTML = `已分配 <b>${filled} / ${totalRequired}</b> 个槽位`;

      confirmBtn.disabled = filled < totalRequired;

    }

  });

}



async function collectMaterialFiles(dirHandle: FileSystemDirectoryHandle): Promise<File[]> {



  const files: File[] = [];



  for await (const entry of (dirHandle as any).values()) {



    if (entry.kind === 'file') {



      files.push(await entry.getFile());



    } else if (entry.kind === 'directory') {



      files.push(...await collectMaterialFiles(entry as FileSystemDirectoryHandle));



    }



  }



  return files;



}







async function renderMaterialList() {



  const listContainer = document.getElementById('material-list');



  if (!listContainer) return;







  listContainer.innerHTML = '';



  const activeIdStr = localStorage.getItem('activeMaterialId');



  const activeId = activeIdStr ? parseInt(activeIdStr) : null;







  // 1. 系统默认材质卡片



  const defaultCard = document.createElement('div');



  defaultCard.className = 'material-card';



  if (activeId === null) {



    defaultCard.classList.add('active');



  }







  const defaultPreview = document.createElement('div');



  defaultPreview.className = 'material-card-preview has-files';







  const img = document.createElement('img');



  img.className = 'material-card-thumb';



  img.src = `assets/playable-blocks/red-1.webp`;



  defaultPreview.appendChild(img);







  const defaultLabel = document.createElement('div');



  defaultLabel.className = 'material-card-label';



  defaultLabel.innerText = '默认';



  defaultLabel.title = '系统默认材质';







  defaultCard.appendChild(defaultPreview);



  defaultCard.appendChild(defaultLabel);







  defaultCard.onclick = async () => {



    await restoreDefaultTextures();



    localStorage.removeItem('activeMaterialId');



    await renderMaterialList();



    alert('已恢复默认材质');



  };







  listContainer.appendChild(defaultCard);







  try {



    const list = await materialDB.getAllMaterials();



    



    const promises = list.map(async item => {



      const card = document.createElement('div');



      card.className = 'material-card';



      if (activeId === item.id) {



        card.classList.add('active');



      }







      const preview = document.createElement('div');



      preview.className = 'material-card-preview';







      if (item.hasTextures) {



        preview.classList.add('has-files');



        const textures = await materialDB.getMaterialTextures(item.id);



        if (textures) {



          const img = document.createElement('img');



          img.className = 'material-card-thumb';



          const firstKey = Object.keys(textures).find(k => k.endsWith('-1')) || Object.keys(textures)[0];



          if (firstKey && textures[firstKey]) {



            img.src = textures[firstKey];



          } else {



            img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="%232a2a35"/></svg>';



          }



          preview.appendChild(img);



        }



      } else {



        const emptyTip = document.createElement('div');



        emptyTip.className = 'material-card-empty';



        emptyTip.innerText = '➕ 导入';



        preview.appendChild(emptyTip);



      }







      const label = document.createElement('div');



      label.className = 'material-card-label';



      label.innerText = item.name;



      label.title = item.name;







      preview.onclick = async () => {



        if (!item.hasTextures) {



          // Import



          try {



            const dirHandle = await (window as any).showDirectoryPicker();



            const textures: Record<string, string> = {};



            let matchCount = 0;







            const selectedFiles = await collectMaterialFiles(dirHandle);



            for (const file of selectedFiles) {



              const parsed = parseMaterialTextureName(file.name);



              if (parsed) {



                const base64 = await fileToBase64(file);



                textures[`${parsed.color}-${parsed.length}`] = base64;



                matchCount++;



              }



            }







            if (matchCount === 0) {



              // 自动识别失败，打开手动映射面板



              const manualTextures = await showMaterialMapperDialog(selectedFiles);

              if (!manualTextures) return; // 用户取消

              // 将手动映射结果合并

              Object.assign(textures, manualTextures);

              matchCount = Object.keys(textures).length;

              if (matchCount === 0) return;



            }







            const requiredKeys = ['red', 'blue', 'green', 'yellow', 'pink']



              .flatMap(materialColor => [1, 2, 3, 4].map(length => `${materialColor}-${length}`));



            const missingKeys = requiredKeys.filter(key => !textures[key]);



            if (missingKeys.length > 0) {



              const proceed = confirm(`材质图片不完整，缺少以下 ${missingKeys.length} 个槽位：\n${missingKeys.join(', ')}\n\n缺少的颜色将使用默认材质显示。是否继续导入？`);



              if (!proceed) return;



            }







            await materialDB.saveMaterialTextures(item.id, textures);



            await preloadAllMaterials();



            await applyMaterialPack(textures);



            localStorage.setItem('activeMaterialId', item.id.toString());



            await renderMaterialList();



            alert(`材质包 "${item.name}" 导入成功。`);



          } catch (err) {



            console.error(err);



            if ((err as Error).name !== 'AbortError') {



              alert('导入材质包失败');



            }



          }



        } else {



          // Switch



          try {



            const textures = await materialDB.getMaterialTextures(item.id);



            if (textures) {



              await applyMaterialPack(textures);



              localStorage.setItem('activeMaterialId', item.id.toString());



              await renderMaterialList();



            } else {



              alert('读取材质包失败！');



            }



          } catch (err) {



            console.error(err);



            alert('读取材质包失败！');



          }



        }



      };







      const deleteBtn = document.createElement('button');



      deleteBtn.className = 'material-card-delete-btn';



      deleteBtn.innerHTML = '×';



      deleteBtn.title = '删除此材质包';



      deleteBtn.onclick = async (e) => {



        e.stopPropagation();



        if (!confirm(`确定要删除材质包 "${item.name}" 吗？`)) return;







        try {



          await materialDB.deleteMaterial(item.id);



          preloadedMaterials.delete(item.id);



          preloadedMaterialIds = preloadedMaterialIds.filter(id => id !== item.id);



          if (activeId === item.id) {



            localStorage.removeItem('activeMaterialId');



            await restoreDefaultTextures();



          }



          await renderMaterialList();



          alert(`Material pack "${item.name}" deleted.`);



        } catch (err) {



          console.error(err);



          alert('删除材质包失败！');



        }



      };







      card.appendChild(preview);



      card.appendChild(label);



      card.appendChild(deleteBtn);



      return card;



    });







    const cards = await Promise.all(promises);



    cards.forEach(c => listContainer.appendChild(c));







    // Add "+" card at the end



    const addCard = document.createElement('div');



    addCard.className = 'material-card';







    const addPreview = document.createElement('div');



    addPreview.className = 'material-card-preview';







    const addIcon = document.createElement('div');



    addIcon.className = 'material-card-empty';



    addIcon.innerText = '+';



    addPreview.appendChild(addIcon);







    const addLabel = document.createElement('div');



    addLabel.className = 'material-card-label';



    addLabel.innerText = '新建';







    addCard.appendChild(addPreview);



    addCard.appendChild(addLabel);



    addCard.onclick = addNewMaterial;







    listContainer.appendChild(addCard);



  } catch (err) {



    console.error('Failed to load materials list:', err);



  }



}







// ---- Collectibles Assets & Helpers ----







interface BuiltinCollectible {



  id: string;



  name: string;



  textureData: string;



  isAnimated?: boolean;



  frames?: string[];



}







const BUILTIN_COLLECTIBLES: BuiltinCollectible[] = [



  {



    id: 'coin',



    name: '金币',



    textureData: 'assets/coin.png'



  },



  {



    id: 'coin2',



    name: '金币2',



    textureData: 'assets/coin2/2_00.png',



    isAnimated: true,



    frames: Array.from({length: 30}, (_, i) => `assets/coin2/2_${String(i).padStart(2, '0')}.png`)



  }



];







function getActiveCollectibleBase64(): string {



  const activeIdStr = String(activeCollectibleId);



  const builtin = BUILTIN_COLLECTIBLES.find(c => c.id === activeIdStr);



  if (builtin) return builtin.textureData;







  const customId = parseInt(activeIdStr);



  const custom = customCollectibles.find(c => c.id === customId);



  if (custom) return custom.texture;







  return BUILTIN_COLLECTIBLES[0].textureData;



}







function updateHeaderUI() {



  const gameHeaderEl = document.getElementById('game-header');



  if (!gameHeaderEl) return;







  const headerItems = gameHeaderEl.getElementsByClassName('header-item');



  if (headerItems.length < 2) return;







  const headerItemEl = headerItems[0] as HTMLElement;



  const scoreHeaderItemEl = headerItems[1] as HTMLElement;



  const collectContainer = document.getElementById('item-collect-container');







  const levelInput = document.getElementById('input-level') as HTMLInputElement;



  const currentLevel = levelInput ? levelInput.value : '284';







  if (isCollectMode) {



    // Left side: LEVEL



    headerItemEl.innerHTML = `LEVEL: <span id="level-val">${currentLevel}</span>`;







    // Right side: Collectible Counter + Hidden Score



    const base64 = getActiveCollectibleBase64();



    scoreHeaderItemEl.style.display = '';



    scoreHeaderItemEl.innerHTML = `<img id="collectible-header-icon" src="${base64}" style="width:36px; height:36px; vertical-align:middle; margin-right:8px; border-radius: 4px;" /> x <span id="collect-val" style="font-weight:bold; font-size:28px; color:#ffffff; vertical-align:middle;">${collectedCount}</span><span id="score-val" style="display:none;"></span>`;







    if (gameHeaderEl) {



      gameHeaderEl.style.justifyContent = 'space-between';



    }



    if (collectContainer) {



      collectContainer.style.display = 'flex';



    }







    // Sync to DOM inputs



    const sliderCollect = document.getElementById('slider-collect') as HTMLInputElement | null;



    const valCollect = document.getElementById('val-collect');



    const inputCollect = document.getElementById('input-collect') as HTMLInputElement | null;



    if (sliderCollect) sliderCollect.value = String(collectedCount);



    if (valCollect) valCollect.textContent = String(collectedCount);



    if (inputCollect) inputCollect.value = String(collectedCount);



  } else {



    // Left side: LEVEL



    headerItemEl.innerHTML = `LEVEL: <span id="level-val">${currentLevel}</span>`;







    // Right side: SCORE



    scoreHeaderItemEl.style.display = '';



    const scoreInput = document.getElementById('input-score') as HTMLInputElement;



    let currentScore = scoreInput ? parseInt(scoreInput.value) || 854682 : 854682;



    scoreHeaderItemEl.innerHTML = `SCORE: <span id="score-val">${currentScore.toLocaleString()}</span>`;







    if (gameHeaderEl) {



      gameHeaderEl.style.justifyContent = 'space-between';



    }



    if (collectContainer) {



      collectContainer.style.display = 'none';



    }



  }



}







async function updateActiveCollectible() {



  const activeIdStr = localStorage.getItem('activeCollectibleId') || 'coin';







  const builtin = BUILTIN_COLLECTIBLES.find(c => c.id === activeIdStr);



  if (builtin) {



    activeCollectibleId = builtin.id;



    if (builtin.isAnimated && builtin.frames) {



      activeCollectibleTextures = [];



      for (const framePath of builtin.frames) {



        const tex = await PIXI.Assets.load<PIXI.Texture>(framePath);



        activeCollectibleTextures.push(tex);



      }



      activeCollectibleTexture = activeCollectibleTextures[0];



    } else {



      activeCollectibleTexture = await PIXI.Assets.load<PIXI.Texture>(builtin.textureData);



      activeCollectibleTextures = [activeCollectibleTexture];



    }



    PIXI.Assets.cache.set(`collectible-${activeCollectibleId}`, activeCollectibleTexture);



  } else {



    const customId = parseInt(activeIdStr);



    if (!isNaN(customId)) {



      const customList = await collectibleDB.getAllCollectibles();



      const custom = customList.find(c => c.id === customId);



      if (custom) {



        activeCollectibleId = custom.id;



        activeCollectibleTexture = await PIXI.Assets.load<PIXI.Texture>(custom.texture);



        activeCollectibleTextures = [activeCollectibleTexture];



        PIXI.Assets.cache.set(`collectible-${activeCollectibleId}`, activeCollectibleTexture);



      } else {



        const defaultColl = BUILTIN_COLLECTIBLES[0];



        activeCollectibleId = defaultColl.id;



        activeCollectibleTexture = await PIXI.Assets.load<PIXI.Texture>(defaultColl.textureData);



        activeCollectibleTextures = [activeCollectibleTexture];



        PIXI.Assets.cache.set(`collectible-${activeCollectibleId}`, activeCollectibleTexture);



      }



    } else {



      const defaultColl = BUILTIN_COLLECTIBLES[0];



      activeCollectibleId = defaultColl.id;



      activeCollectibleTexture = await PIXI.Assets.load<PIXI.Texture>(defaultColl.textureData);



      activeCollectibleTextures = [activeCollectibleTexture];



      PIXI.Assets.cache.set(`collectible-${activeCollectibleId}`, activeCollectibleTexture);



    }



  }







  blocks.forEach(b => {



    if (b.isCollectible) {



      if (b.sprite instanceof PIXI.AnimatedSprite && activeCollectibleTextures && activeCollectibleTextures.length > 0) {



        b.sprite.textures = activeCollectibleTextures;



        b.sprite.play();



      } else if (activeCollectibleTexture) {



        b.sprite.texture = activeCollectibleTexture;



      }



    }



  });







  if (currentMode === 'manual' && manualSelectedBlock && manualSelectedBlock.color === 'collectible') {



    initOrUpdateManualPreviewSprite(manualSelectedBlock.length, 'collectible', manualPreviewSprite ? manualPreviewSprite.visible : false);



  }







  updateHeaderUI();



}







async function renderCollectibleList() {



  const listContainer = document.getElementById('collectible-list');



  if (!listContainer) return;







  listContainer.innerHTML = '';



  try {



    customCollectibles = await collectibleDB.getAllCollectibles();



  } catch (err) {



    console.error('Failed to get collectibles from DB:', err);



    customCollectibles = [];



  }







  const activeIdStr = localStorage.getItem('activeCollectibleId') || 'coin';







  BUILTIN_COLLECTIBLES.forEach(item => {



    const card = document.createElement('div');



    card.className = 'material-card';



    if (activeIdStr === item.id) {



      card.classList.add('active');



    }







    const preview = document.createElement('div');



    preview.className = 'material-card-preview has-files';







    const img = document.createElement('img');



    img.className = 'material-card-thumb';



    img.src = item.textureData;



    preview.appendChild(img);







    const label = document.createElement('div');



    label.className = 'material-card-label';



    label.innerText = item.name;



    label.title = item.name;







    card.appendChild(preview);



    card.appendChild(label);







    card.onclick = async () => {



      localStorage.setItem('activeCollectibleId', item.id);



      await updateActiveCollectible();



      await renderCollectibleList();



    };







    listContainer.appendChild(card);



  });







  customCollectibles.forEach(item => {



    const card = document.createElement('div');



    card.className = 'material-card';



    if (activeIdStr === String(item.id)) {



      card.classList.add('active');



    }







    const preview = document.createElement('div');



    preview.className = 'material-card-preview has-files';







    const img = document.createElement('img');



    img.className = 'material-card-thumb';



    img.src = item.texture;



    preview.appendChild(img);







    const label = document.createElement('div');



    label.className = 'material-card-label';



    label.innerText = item.name;



    label.title = item.name;







    const deleteBtn = document.createElement('button');



    deleteBtn.className = 'material-card-delete-btn';



    deleteBtn.innerHTML = '×';



    deleteBtn.title = '删除此收集物';



    deleteBtn.onclick = async (e) => {



      e.stopPropagation();



      if (!confirm(`确定要删除收集物 "${item.name}" 吗？`)) return;



      try {



        await collectibleDB.deleteCollectible(item.id);



        if (localStorage.getItem('activeCollectibleId') === String(item.id)) {



          localStorage.setItem('activeCollectibleId', 'coin');



          await updateActiveCollectible();



        }



        await renderCollectibleList();



      } catch (err) {



        console.error(err);



        alert('删除收集物失败！');



      }



    };







    card.appendChild(preview);



    card.appendChild(label);



    card.appendChild(deleteBtn);







    card.onclick = async () => {



      localStorage.setItem('activeCollectibleId', String(item.id));



      await updateActiveCollectible();



      await renderCollectibleList();



    };







    listContainer.appendChild(card);



  });







  const addCard = document.createElement('div');



  addCard.className = 'material-card';







  const addPreview = document.createElement('div');



  addPreview.className = 'material-card-preview';







  const addIcon = document.createElement('div');



  addIcon.className = 'material-card-empty';



  addIcon.innerText = '+';



  addPreview.appendChild(addIcon);







  const addLabel = document.createElement('div');



  addLabel.className = 'material-card-label';



  addLabel.innerText = '导入';







  addCard.appendChild(addPreview);



  addCard.appendChild(addLabel);







  addCard.onclick = () => {



    const input = document.createElement('input');



    input.type = 'file';



    input.accept = 'image/*';



    input.onchange = async () => {



      const file = input.files?.[0];



      if (!file) return;







      const reader = new FileReader();



      reader.onload = async (e) => {



        const base64 = e.target?.result as string;



        if (!base64) return;







        const name = prompt("Enter collectible name:");



        if (name === null) return;



        const cleanName = name.trim() || `自定义收集物_${new Date().toLocaleTimeString()}`;







        try {



          await collectibleDB.addCollectible(cleanName, base64);



          await renderCollectibleList();



        } catch (dbErr) {



          console.error(dbErr);



          alert('导入收集物失败！');



        }



      };



      reader.readAsDataURL(file);



    };



    input.click();



  };







  listContainer.appendChild(addCard);



}







function createCollectibleTrailParticle(x: number, y: number, angle: number) {



  // 1. Spawn a glowing tapered core beam particle (white/cyan)



  {



    const g = new PIXI.Graphics();



    



    // Choose core color: mostly white, sometimes light cyan



    const color = Math.random() < 0.75 ? 0xffffff : 0xd8f8ff;



    const thickness = PARAMS.cellSize * 0.28; // ~14px wide (smaller)



    const length = Math.random() * 35 + 30; // 30 to 65px long (shorter)







    // A. Soft outer neon cyan glow wedge (behind)



    const outerWidth = thickness * 1.8;



    g.moveTo(0, -outerWidth / 2);



    g.lineTo(0, outerWidth / 2);



    g.lineTo(-length * 1.2, 0);



    g.closePath();



    g.fill({ color: 0x00f0ff, alpha: 0.22 }); // higher transparency







    // B. Intermediate cyan glow wedge



    const midWidth = thickness * 1.2;



    g.moveTo(0, -midWidth / 2);



    g.lineTo(0, midWidth / 2);



    g.lineTo(-length * 1.0, 0);



    g.closePath();



    g.fill({ color: 0x00d8ff, alpha: 0.45 }); // higher transparency







    // C. Sharp bright white/cyan core wedge (on top)



    g.moveTo(0, -thickness / 2);



    g.lineTo(0, thickness / 2);



    g.lineTo(-length, thickness * 0.12);



    g.lineTo(-length, -thickness * 0.12);



    g.closePath();



    g.fill({ color: color, alpha: 0.75 }); // some transparency in core







    g.blendMode = 'add';



    g.rotation = angle + (Math.random() - 0.5) * 0.05; // tiny wobble



    g.x = x;



    g.y = y;







    // Apply blur filter to soften the hard edges of the triangle wedges into a glowing cloud trail



    const blur = new PIXI.BlurFilter();



    blur.blur = 4;



    g.filters = [blur];







    gameContainer.addChild(g);







    // Drift backwards along trajectory



    const speed = Math.random() * 1.5 + 1.2;



    const vx = -Math.cos(angle) * speed;



    const vy = -Math.sin(angle) * speed;







    activeParticles.push({



      sprite: g,



      vx,



      vy,



      alphaDecay: Math.random() * 0.035 + 0.03, // lasts ~25-35 frames



      scaleDecay: Math.random() * 0.02 + 0.015



    });



  }







  // 2. Spawn 1-2 tiny sparkling 4-point stars scattered in the tail



  const numStars = Math.floor(Math.random() * 2) + 1; // 1 or 2 stars



  for (let k = 0; k < numStars; k++) {



    const g = new PIXI.Graphics();



    



    // Choose white or bright cyan for the star



    const color = Math.random() < 0.6 ? 0xffffff : 0xa6f9ff;



    const size = Math.random() * 3.5 + 3.0; // 3.0 to 6.5px star size







    // Draw 4-point sparkle star using quadratic curves



    g.moveTo(0, -size);



    g.quadraticCurveTo(0, 0, size, 0);



    g.quadraticCurveTo(0, 0, 0, size);



    g.quadraticCurveTo(0, 0, -size, 0);



    g.quadraticCurveTo(0, 0, 0, -size);



    g.fill({ color: color, alpha: 0.65 });



    g.blendMode = 'add';



    



    // Spawn along the trail behind the core (offset backwards along travel direction)



    const distBack = Math.random() * 45; // 0 to 45px behind head



    const perpOffset = (Math.random() - 0.5) * 15; // spread sideways



    



    const forwardX = Math.cos(angle);



    const forwardY = Math.sin(angle);



    const perpX = -forwardY;



    const perpY = forwardX;



    



    g.x = x - forwardX * distBack + perpX * perpOffset;



    g.y = y - forwardY * distBack + perpY * perpOffset;



    



    // Random initial rotation and spin speed



    g.rotation = Math.random() * Math.PI * 2;



    gameContainer.addChild(g);







    const speed = Math.random() * 0.8 + 0.4;



    const vx = -forwardX * speed;



    const vy = -forwardY * speed;







    activeParticles.push({



      sprite: g,



      vx,



      vy,



      alphaDecay: Math.random() * 0.025 + 0.02,



      scaleDecay: Math.random() * 0.018 + 0.012,



      vRot: (Math.random() - 0.5) * 0.12



    });



  }



}







function createCollectibleBurstEffect(x: number, y: number) {



  // Spawn 10-15 sparkle stars moving in random directions (explosive burst)



  const numStars = 10 + Math.floor(Math.random() * 6);



  for (let i = 0; i < numStars; i++) {



    const g = new PIXI.Graphics();



    const color = Math.random() < 0.6 ? 0xffffff : 0xa6f9ff;



    const size = Math.random() * 4.0 + 3.0; // 3.0 to 7.0px star size







    g.moveTo(0, -size);



    g.quadraticCurveTo(0, 0, size, 0);



    g.quadraticCurveTo(0, 0, 0, size);



    g.quadraticCurveTo(0, 0, -size, 0);



    g.quadraticCurveTo(0, 0, 0, -size);



    g.fill({ color: color, alpha: 0.85 });



    g.blendMode = 'add';







    g.x = x;



    g.y = y;



    g.rotation = Math.random() * Math.PI * 2;



    gameContainer.addChild(g);







    const moveAngle = Math.random() * Math.PI * 2;



    const speed = Math.random() * 3.0 + 1.5;



    const vx = Math.cos(moveAngle) * speed;



    const vy = Math.sin(moveAngle) * speed;







    activeParticles.push({



      sprite: g,



      vx,



      vy,



      gravity: 0.06,



      alphaDecay: Math.random() * 0.035 + 0.025, // lasts ~25-40 frames



      scaleDecay: Math.random() * 0.02 + 0.012,



      vRot: (Math.random() - 0.5) * 0.15



    });



  }







  // Spawn 5-7 expanding glowing cyan puff circles



  const numPuffs = 5 + Math.floor(Math.random() * 3);



  for (let i = 0; i < numPuffs; i++) {



    const g = new PIXI.Graphics();



    const radius = Math.random() * 6 + 4;



    g.circle(0, 0, radius);



    g.fill({ color: 0x00f0ff, alpha: 0.25 });



    g.blendMode = 'add';







    const blur = new PIXI.BlurFilter();



    blur.blur = 3;



    g.filters = [blur];







    g.x = x;



    g.y = y;



    gameContainer.addChild(g);







    const moveAngle = Math.random() * Math.PI * 2;



    const speed = Math.random() * 1.5 + 0.8;



    const vx = Math.cos(moveAngle) * speed;



    const vy = Math.sin(moveAngle) * speed;







    activeParticles.push({



      sprite: g,



      vx,



      vy,



      alphaDecay: Math.random() * 0.045 + 0.035, // fades very quickly



      scaleDecay: Math.random() * 0.025 + 0.015



    });



  }



}







function playCollectibleFlyAnimation(b: Block) {



  const base64 = getActiveCollectibleBase64();



  



  const flyImg = document.createElement('img');



  flyImg.className = 'collectible-fly-img';



  flyImg.src = base64;



  flyImg.style.position = 'absolute';



  flyImg.style.width = `${PARAMS.cellSize}px`;



  flyImg.style.height = `${PARAMS.cellSize}px`;



  flyImg.style.pointerEvents = 'none';



  flyImg.style.zIndex = '9999';



  flyImg.style.borderRadius = '4px';







  const boardWrapper = document.getElementById('board-wrapper');



  if (!boardWrapper) return;



  



  const canvasRect = app.canvas.getBoundingClientRect();



  const boardRect = boardWrapper.getBoundingClientRect();



  



  const cellCanvasX = b.col * PARAMS.cellSize;



  const cellCanvasY = b.row * PARAMS.cellSize + worldContainer.y;



  



  // Trigger start-of-flight explosion/burst at block center



  const startStageX = cellCanvasX + PARAMS.cellSize / 2;



  const startStageY = cellCanvasY + PARAMS.cellSize / 2;



  createCollectibleBurstEffect(startStageX, startStageY);



  



  const globalX = canvasRect.left + (cellCanvasX * (canvasRect.width / (PARAMS.gridCols * PARAMS.cellSize)));



  const globalY = canvasRect.top + (cellCanvasY * (canvasRect.height / getViewportGameHeight()));



  



  const startLeft = globalX - boardRect.left;



  const startTop = globalY - boardRect.top;



  



  flyImg.style.left = `${startLeft}px`;



  flyImg.style.top = `${startTop}px`;



  



  boardWrapper.appendChild(flyImg);



  



  const targetEl = document.getElementById('collectible-header-icon');



  let targetLeft = 40;



  let targetTop = 15;



  if (targetEl) {



    const targetRect = targetEl.getBoundingClientRect();



    targetLeft = targetRect.left - boardRect.left;



    targetTop = targetRect.top - boardRect.top;



  }



  



  let lastX: number | null = null;



  let lastY: number | null = null;







  const tl = gsap.timeline({



    onUpdate: () => {



      const builtin = BUILTIN_COLLECTIBLES.find(c => c.id === activeCollectibleId);



      if (builtin && builtin.isAnimated && builtin.frames) {



        const frameIndex = Math.floor(tl.progress() * (builtin.frames.length - 1));



        flyImg.src = builtin.frames[frameIndex];



      }







      // Play particle trail for 95% of the flight



      if (tl.progress() <= 0.95) {



        const currentRect = flyImg.getBoundingClientRect();



        const curX = currentRect.left + currentRect.width / 2;



        const curY = currentRect.top + currentRect.height / 2;







        const currentStageX = (curX - canvasRect.left) * (app.renderer.width / canvasRect.width);



        const currentStageY = (curY - canvasRect.top) * (app.renderer.height / canvasRect.height);



        



        const fitScale = app.stage.scale.x || 1;



        const localX = (currentStageX / fitScale) - PADDING;



        const localY = (currentStageY / fitScale) - PADDING;







        if (localY >= 0 && localX >= 0 && localX <= PARAMS.gridCols * PARAMS.cellSize) {



          let frameAngle = -Math.PI / 2; // Default to pointing upwards



          if (lastX !== null && lastY !== null) {



            const dx = curX - lastX;



            const dy = curY - lastY;



            if (dx !== 0 || dy !== 0) {



              frameAngle = Math.atan2(dy, dx);



            }



          }



          createCollectibleTrailParticle(localX, localY, frameAngle);



        }



        



        lastX = curX;



        lastY = curY;



      }



    },



    onComplete: () => {



      if (flyImg.parentNode) {



        flyImg.parentNode.removeChild(flyImg);



      }



      



      collectedCount++;



      updateHeaderUI();



    }



  });







  const randomOffset = (Math.random() - 0.5) * 15;







  // Stage 1: Scale up and drop down (anticipation)



  tl.to(flyImg, {



    left: startLeft + randomOffset,



    top: startTop + 45,



    width: PARAMS.cellSize * 1.5,



    height: PARAMS.cellSize * 1.5,



    duration: 0.35,



    ease: 'power1.out'



  });







  // Stage 2: Fly up and shrink to collector size



  tl.to(flyImg, {



    left: targetLeft,



    top: targetTop,



    width: 36,



    height: 36,



    duration: 0.65,



    ease: 'power2.inOut'



  });







  // Delay the collect (swish) sound effect by 0.5s to align with flight



  tl.call(() => {



    playSound(sounds.collect);



  }, [], 0.5);



}







function deactivateCollectMode() {



  if (isCollectMode) {



    isCollectMode = false;



    collectedCount = 0;



    const btnCollectMode = document.getElementById('btn-collect-mode');



    if (btnCollectMode) {



      btnCollectMode.classList.remove('blue');



      btnCollectMode.classList.add('gray');



    }



    const collectibleBlocks = blocks.filter(b => b.isCollectible);



    collectibleBlocks.forEach(b => {



      const col = b.col;



      const row = b.row;



      const length = b.length;



      const color = b.color;



      const id = b.id;



      const noGravity = b.noGravity;







      blocksContainer.removeChild(b.sprite);



      b.sprite.destroy();



      blocks = blocks.filter(item => item.id !== id);







      spawnBlock(col, row, length, color, id, noGravity, false);



    });







    const sliderCollect = document.getElementById('slider-collect') as HTMLInputElement | null;



    const valCollect = document.getElementById('val-collect');



    const inputCollect = document.getElementById('input-collect') as HTMLInputElement | null;



    if (sliderCollect) sliderCollect.value = '0';



    if (valCollect) valCollect.textContent = '0';



    if (inputCollect) inputCollect.value = '0';







    updateHeaderUI();



  }



}







async function renderSoundList() {



  const listContainer = document.getElementById('sound-list');



  if (!listContainer) return;







  listContainer.innerHTML = '';



  const activeIdStr = localStorage.getItem('activeSoundId');



  const activeId = (activeIdStr && activeIdStr !== 'default') ? parseInt(activeIdStr) : 'default';







  // 1. 系统默认音效卡片



  const defaultCard = document.createElement('div');



  defaultCard.className = 'material-card';



  if (activeId === 'default') {



    defaultCard.classList.add('active');



  }







  const defaultPreview = document.createElement('div');



  defaultPreview.className = 'material-card-preview has-files';







  const defaultIcon = document.createElement('div');



  defaultIcon.className = 'material-card-sound-icon';



  defaultIcon.innerText = '🔊';



  defaultPreview.appendChild(defaultIcon);







  const defaultLabel = document.createElement('div');



  defaultLabel.className = 'material-card-label';



  defaultLabel.innerText = '默认';



  defaultLabel.title = '系统默认音效';







  defaultCard.appendChild(defaultPreview);



  defaultCard.appendChild(defaultLabel);







  defaultCard.onclick = () => {



    restoreDefaultSounds();



    localStorage.setItem('activeSoundId', 'default');



    renderSoundList();



    alert('已恢复默认音效');



  };







  listContainer.appendChild(defaultCard);







  try {



    const list = await soundDB.getAllSounds();







    list.forEach(item => {



      const card = document.createElement('div');



      card.className = 'material-card';



      if (activeId === item.id) {



        card.classList.add('active');



      }







      const preview = document.createElement('div');



      preview.className = 'material-card-preview';







      if (item.hasSounds) {



        preview.classList.add('has-files');



        const icon = document.createElement('div');



        icon.className = 'material-card-sound-icon';



        icon.innerText = '🎵';



        preview.appendChild(icon);



      } else {



        const emptyTip = document.createElement('div');



        emptyTip.className = 'material-card-empty';



        emptyTip.innerText = '➕ 导入';



        preview.appendChild(emptyTip);



      }







      const label = document.createElement('div');



      label.className = 'material-card-label';



      label.innerText = item.name;



      label.title = item.name;







      preview.onclick = async () => {



        if (!item.hasSounds) {



          // Import



          try {



            const dirHandle = await (window as any).showDirectoryPicker();



            const soundsData: Record<string, string> = {};



            let matchCount = 0;







            for await (const entry of dirHandle.values()) {



              if (entry.kind === 'file') {



                const file = await entry.getFile();



                const name = file.name.toLowerCase();



                



                let soundKey = '';



                if (name.includes('移动') || name.includes('move') || name.includes('spawn') || name.includes('出块')) {



                  soundKey = 'spawn';



                } else if (name.includes('下落') || name.includes('fall') || name.includes('drop')) {



                  soundKey = 'fall';



                } else if (name.includes('破碎') || name.includes('消除') || name.includes('shatter') || name.includes('eliminate') || name.includes('combo') || name.includes('destroy')) {



                  soundKey = 'shatter';



                }







                if (soundKey) {



                  const base64 = await fileToBase64(file);



                  soundsData[soundKey] = base64;



                  matchCount++;



                }



              }



            }







            if (matchCount === 0) {



              alert('未找到匹配的音效文件。\n支持关键词：\n- 移动/move/spawn/出块\n- 下落/fall/drop\n- 破碎/消除/shatter/eliminate/combo/destroy');



              return;



            }







            await soundDB.saveSoundFiles(item.id, soundsData);



            applySoundPack(soundsData);



            localStorage.setItem('activeSoundId', item.id.toString());



            await renderSoundList();



            alert(`Imported sound pack "${item.name}".`);



          } catch (err) {



            console.error(err);



            if ((err as Error).name !== 'AbortError') {



              alert("Failed to import sound pack.");



            }



          }



        } else {



          // Switch



          try {



            const soundsData = await soundDB.getSoundFiles(item.id);



            if (soundsData) {



              applySoundPack(soundsData);



              localStorage.setItem('activeSoundId', item.id.toString());



              await renderSoundList();



            } else {



              alert('读取音效包失败！');



            }



          } catch (err) {



            console.error(err);



            alert('读取音效包失败！');



          }



        }



      };







      const deleteBtn = document.createElement('button');



      deleteBtn.className = 'material-card-delete-btn';



      deleteBtn.innerHTML = '×';



      deleteBtn.title = '删除此音效包';



      deleteBtn.onclick = async (e) => {



        e.stopPropagation();



        if (!confirm(`确定要删除音效包 "${item.name}" 吗？`)) return;







        try {



          await soundDB.deleteSound(item.id);



          if (activeId === item.id) {



            localStorage.removeItem('activeSoundId');



            restoreDefaultSounds();



          }



          await renderSoundList();



          alert(`Sound pack "${item.name}" deleted.`);



        } catch (err) {



          console.error(err);



          alert('删除音效包失败！');



        }



      };







      card.appendChild(preview);



      card.appendChild(label);



      card.appendChild(deleteBtn);



      listContainer.appendChild(card);



    });







    // Add "+" card at the end



    const addCard = document.createElement('div');



    addCard.className = 'material-card';







    const addPreview = document.createElement('div');



    addPreview.className = 'material-card-preview';







    const addIcon = document.createElement('div');



    addIcon.className = 'material-card-empty';



    addIcon.innerText = '+';



    addPreview.appendChild(addIcon);







    const addLabel = document.createElement('div');



    addLabel.className = 'material-card-label';



    addLabel.innerText = '新建';







    addCard.appendChild(addPreview);



    addCard.appendChild(addLabel);



    addCard.onclick = addNewSound;







    listContainer.appendChild(addCard);



  } catch (err) {



    console.error('Failed to load sounds list:', err);



  }



}







async function addNewEffect() {



  const name = prompt('请输入新特效包的名称');



  if (!name) return;







  try {



    await effectDB.addEffect(name);



    await renderEffectList();



  } catch (err) {



    console.error(err);



    alert('新建特效包失败！');



  }



}







async function renderEffectList() {



  const listContainer = document.getElementById('effect-list');



  if (!listContainer) return;







  listContainer.innerHTML = '';



  const activeIdStr = localStorage.getItem('activeEffectId');



  const activeId = (activeIdStr && activeIdStr !== 'default') ? parseInt(activeIdStr) : 'default';







  // 1. 系统默认特效卡片



  const defaultCard = document.createElement('div');



  defaultCard.className = 'material-card';



  if (activeId === 'default') {



    defaultCard.classList.add('active');



  }







  const defaultPreview = document.createElement('div');



  defaultPreview.className = 'material-card-preview has-files';







  const defaultIcon = document.createElement('div');



  defaultIcon.className = 'material-card-sound-icon';



  defaultIcon.innerText = '💥';



  defaultPreview.appendChild(defaultIcon);







  const defaultLabel = document.createElement('div');



  defaultLabel.className = 'material-card-label';



  defaultLabel.innerText = '默认';



  defaultLabel.title = '系统默认特效';







  defaultCard.appendChild(defaultPreview);



  defaultCard.appendChild(defaultLabel);







  defaultCard.onclick = () => {



    restoreDefaultEffects();



    localStorage.setItem('activeEffectId', 'default');



    renderEffectList();



    alert('已恢复默认特效');



  };







  listContainer.appendChild(defaultCard);







  try {



    const list = await effectDB.getAllEffects();







    const promises = list.map(async item => {



      const card = document.createElement('div');



      card.className = 'material-card';



      if (activeId === item.id) {



        card.classList.add('active');



      }







      const preview = document.createElement('div');



      preview.className = 'material-card-preview';







      if (item.hasEffects) {



        preview.classList.add('has-files');



        const effectFiles = await effectDB.getEffectFiles(item.id);



        if (effectFiles) {



          const img = document.createElement('img');



          img.className = 'material-card-thumb';



          // Find the first frame to use as thumbnail



          const sortedKeys = Object.keys(effectFiles).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));



          const firstKey = sortedKeys[0];



          if (firstKey && effectFiles[firstKey]) {



            img.src = effectFiles[firstKey];



          } else {



            img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="%232a2a35"/></svg>';



          }



          preview.appendChild(img);



        }



      } else {



        const emptyTip = document.createElement('div');



        emptyTip.className = 'material-card-empty';



        emptyTip.innerText = '➕ 导入';



        preview.appendChild(emptyTip);



      }







      const label = document.createElement('div');



      label.className = 'material-card-label';



      label.innerText = item.name;



      label.title = item.name;







      preview.onclick = async () => {



        if (!item.hasEffects) {



          // Import



          try {



            const dirHandle = await (window as any).showDirectoryPicker();



            const effectsData: Record<string, string> = {};



            let matchCount = 0;







            for await (const entry of dirHandle.values()) {



              if (entry.kind === 'file') {



                const file = await entry.getFile();



                const name = file.name.toLowerCase();



                



                // Expect files like 0.png, 1.png, 2.png or 001.png, etc.



                const match = name.match(/^(\d+)\.(png|jpg|jpeg|webp)$/i);



                if (match) {



                  const frameIndexStr = match[1];



                  const base64 = await fileToBase64(file);



                  effectsData[frameIndexStr] = base64;



                  matchCount++;



                }



              }



            }







            if (matchCount === 0) {



              alert("No matching sequence frames found. Use names like 0.png, 1.png, 2.png.");



              return;



            }







            await effectDB.saveEffectFiles(item.id, effectsData);



            await applyEffectPack(effectsData);



            localStorage.setItem('activeEffectId', item.id.toString());



            await renderEffectList();



            alert(`Imported effect pack "${item.name}".`);



          } catch (err) {



            console.error(err);



            if ((err as Error).name !== 'AbortError') {



              alert("Failed to import effect pack.");



            }



          }



        } else {



          // Switch



          try {



            const effectsData = await effectDB.getEffectFiles(item.id);



            if (effectsData) {



              await applyEffectPack(effectsData);



              localStorage.setItem('activeEffectId', item.id.toString());



              await renderEffectList();



            } else {



              alert('读取特效包失败！');



            }



          } catch (err) {



            console.error(err);



            alert('读取特效包失败！');



          }



        }



      };







      const deleteBtn = document.createElement('button');



      deleteBtn.className = 'material-card-delete-btn';



      deleteBtn.innerHTML = '×';



      deleteBtn.title = '删除此特效包';



      deleteBtn.onclick = async (e) => {



        e.stopPropagation();



        if (!confirm(`确定要删除特效包 "${item.name}" 吗？`)) return;







        try {



          await effectDB.deleteEffect(item.id);



          if (activeId === item.id) {



            localStorage.removeItem('activeEffectId');



            restoreDefaultEffects();



          }



          await renderEffectList();



          alert(`Effect pack "${item.name}" deleted.`);



        } catch (err) {



          console.error(err);



          alert('删除特效包失败！');



        }



      };







      card.appendChild(preview);



      card.appendChild(label);



      card.appendChild(deleteBtn);



      listContainer.appendChild(card);



    });







    await Promise.all(promises);







    // Add "+" card at the end



    const addCard = document.createElement('div');



    addCard.className = 'material-card';







    const addPreview = document.createElement('div');



    addPreview.className = 'material-card-preview';







    const addIcon = document.createElement('div');



    addIcon.className = 'material-card-empty';



    addIcon.innerText = '+';



    addPreview.appendChild(addIcon);







    const addLabel = document.createElement('div');



    addLabel.className = 'material-card-label';



    addLabel.innerText = '新建';







    addCard.appendChild(addPreview);



    addCard.appendChild(addLabel);



    addCard.onclick = addNewEffect;







    listContainer.appendChild(addCard);



  } catch (err) {



    console.error('Failed to load effects list:', err);



  }



}







// ---- Audio ----



const DEFAULT_SOUND_SOURCES = {
  propElim: soundPropElimUrl,
  fall: soundFallUrl,
  spawn: soundSpawnUrl,
  collect: soundCollectUrl,
  obtain: soundObtainUrl,
} as const;

// A standalone playable only needs one crisp shatter cue. Reusing it for
// combo levels preserves feedback without embedding ten near-identical files.
const DEFAULT_COMBO_SOURCES = isStandalonePlayable
  ? Array.from({ length: 10 }, () => soundShatterUrl)
  : Array.from({ length: 10 }, (_, index) => `assets/递进消除音效/gem_combo_${index + 1}.mp3`);



const DEFAULT_VOCAL_SOURCES = (isStandalonePlayable ? {
  good: '', great: '', amazing: '', excellent: '', unbelievable: '',
} : {
  good: 'assets/人声/good.mp3',
  great: 'assets/人声/great.mp3',
  amazing: 'assets/人声/amazing.mp3',
  excellent: 'assets/人声/Excellent.mp3',
  unbelievable: 'assets/人声/unbelievable.mp3',
});



const FEMALE_VOCAL_SOURCES = (isStandalonePlayable ? {
  good: '', great: '', amazing: '', excellent: '', unbelievable: '',
} : {
  good: 'assets/人声/女生/good.mp3',
  great: 'assets/人声/女生/great.mp3',
  amazing: 'assets/人声/女生/amazing.mp3',
  excellent: 'assets/人声/女生/excellent.mp3',
  unbelievable: 'assets/人声/女生/cool.mp3',
});



type VocalPackId = 'male' | 'female';



const VOCAL_PACK_SOURCES = {



  male: DEFAULT_VOCAL_SOURCES,



  female: FEMALE_VOCAL_SOURCES



} as const;



const storedVocalPack = localStorage.getItem('activeVocalPack');



let activeVocalPack: VocalPackId = storedVocalPack === 'female' ? 'female' : 'male';



const initialVocalSources = VOCAL_PACK_SOURCES[activeVocalPack];







function createGameAudio(src: string): HTMLAudioElement {



  const audio = new Audio();



  audio.crossOrigin = 'anonymous';



  audio.preload = 'auto';



  audio.src = src;



  return audio;



}







const sounds = {

  propElim: createGameAudio((DEFAULT_SOUND_SOURCES as any).propElim || '/audio/prop_elim.ogg'),

  fall: createGameAudio(DEFAULT_SOUND_SOURCES.fall),



  spawn: createGameAudio(DEFAULT_SOUND_SOURCES.spawn),



  collect: createGameAudio(DEFAULT_SOUND_SOURCES.collect),



  obtain: createGameAudio(DEFAULT_SOUND_SOURCES.obtain),



  combos: DEFAULT_COMBO_SOURCES.map(createGameAudio),



  vocals: {



    good: createGameAudio(initialVocalSources.good),



    great: createGameAudio(initialVocalSources.great),



    amazing: createGameAudio(initialVocalSources.amazing),



    excellent: createGameAudio(initialVocalSources.excellent),



    unbelievable: createGameAudio(initialVocalSources.unbelievable)



  }



};







const originalCombosSrc = [...DEFAULT_COMBO_SOURCES];







function syncVocalPackUI() {



  document.querySelectorAll<HTMLButtonElement>('.voice-pack-btn').forEach(button => {



    button.classList.toggle('active', button.dataset.voicePack === activeVocalPack);



  });



}







function applyVocalPack(pack: VocalPackId) {



  activeVocalPack = pack;



  const sources = VOCAL_PACK_SOURCES[pack];



  (Object.keys(sounds.vocals) as Array<keyof typeof sounds.vocals>).forEach(key => {



    sounds.vocals[key].src = sources[key];



    sounds.vocals[key].load();



  });



  localStorage.setItem('activeVocalPack', pack);



  syncVocalPackUI();



}







function applySoundPack(soundFiles: Record<string, string>) {



  if (soundFiles['spawn']) {



    sounds.spawn.src = soundFiles['spawn'];



  } else {



    sounds.spawn.src = DEFAULT_SOUND_SOURCES.spawn;



  }



  sounds.spawn.load();



  



  if (soundFiles['fall']) {



    sounds.fall.src = soundFiles['fall'];



  } else {



    sounds.fall.src = DEFAULT_SOUND_SOURCES.fall;



  }



  sounds.fall.load();



  



  if (soundFiles['shatter']) {



    sounds.combos.forEach(audio => {



      audio.src = soundFiles['shatter'];



      audio.load();



    });



  } else {



    sounds.combos.forEach((audio, i) => {



      audio.src = originalCombosSrc[i];



      audio.load();



    });



  }



}







function restoreDefaultSounds() {



  sounds.spawn.src = DEFAULT_SOUND_SOURCES.spawn;



  sounds.spawn.load();



  sounds.fall.src = DEFAULT_SOUND_SOURCES.fall;



  sounds.fall.load();



  sounds.collect.src = DEFAULT_SOUND_SOURCES.collect;



  sounds.collect.load();



  sounds.obtain.src = DEFAULT_SOUND_SOURCES.obtain;



  sounds.obtain.load();



  sounds.combos.forEach((audio, i) => {



    audio.src = originalCombosSrc[i];



    audio.load();



  });



  applyVocalPack(activeVocalPack);



}







let audioCtx: AudioContext | null = null;



let recAudioDest: MediaStreamAudioDestinationNode | null = null;



let audioSourcesInitialized = false;







function initAudioContext() {



  if (audioSourcesInitialized) return;



  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;



  if (!AudioContextClass) return;







  audioCtx = new AudioContextClass();



  recAudioDest = audioCtx.createMediaStreamDestination();







  const connectAudio = (audio: HTMLAudioElement) => {



    audio.crossOrigin = "anonymous";



    const source = audioCtx!.createMediaElementSource(audio);



    source.connect(audioCtx!.destination);



    source.connect(recAudioDest!);



  };







  connectAudio(sounds.fall);

  connectAudio((sounds as any).propElim);
  connectAudio(sounds.spawn);



  connectAudio(sounds.collect);



  connectAudio(sounds.obtain);



  sounds.combos.forEach(connectAudio);



  Object.values(sounds.vocals).forEach(connectAudio);







  audioSourcesInitialized = true;



}







function playSound(audio: HTMLAudioElement) {



  if (!audioSourcesInitialized) {



    initAudioContext();



  }







  const startPlayback = () => {



    audio.currentTime = 0;



    audio.play().catch(err => console.warn('Audio playback failed:', err));



  };







  if (audioCtx && audioCtx.state === 'suspended') {



    audioCtx.resume().then(startPlayback).catch(err => {



      console.warn('Audio context resume failed:', err);



      startPlayback();



    });



    return;



  }







  startPlayback();



}







interface Block {



  id: number;



  col: number;



  row: number;



  length: number;



  color: string;



  sprite: PIXI.Sprite;



  noGravity?: boolean;



  isCollectible?: boolean;



  isProp?: boolean;



  propType?: 'row-bomb' | 'peppermint';

  propDir?: 'left' | 'right';



}







let app: PIXI.Application;



let gameContainer: PIXI.Container;



let worldContainer: PIXI.Container;



let boardViewportMask: PIXI.Graphics;



const PADDING = 0;



let virtualScrollY = 0;
let continuousScrollOffset = 0;

function ensureContinuousScrollSupplyRow() {



  const supplyPlan = getRisingSupplyRowPlan(PARAMS.totalRows);



  if (blocks.some(block => block.row === supplyPlan.spawnRow)) return;



  spawnFallingSupplyRow(supplyPlan.spawnRow, supplyPlan.finalRow);



}



function advanceContinuousScroll(deltaSec: number) {



  if (



    !worldContainer



    || !isGameStarted



    || getActiveBoardMechanic() !== 'scroll'



    || isPlayingStepTransition



  ) return;



  const cellSize = Math.max(1, PARAMS.cellSize || 1);



  if (!isAnimating) ensureContinuousScrollSupplyRow();



  continuousScrollOffset += Math.max(1, PARAMS.scrollSpeed || 1) * deltaSec;



  const reachedTopDuringScroll = isAnimating



    ? blocks.some(block => (



      block.row < PARAMS.totalRows



      && block.sprite.y - continuousScrollOffset <= 0



    ))



    : hasContinuousScrollTopCollision(blocks, cellSize, continuousScrollOffset, PARAMS.totalRows);



  if (reachedTopDuringScroll) {



    triggerGameOver('continuous-scroll-top');



    return;



  }



  if (isAnimating) {



    worldContainer.y = -continuousScrollOffset;



    virtualScrollY = worldContainer.y;



    return;



  }



  while (continuousScrollOffset >= cellSize) {


    blocks.forEach(b => {



      b.row -= 1;



      b.sprite.y = b.row * cellSize;



    });



    for (let row = 0; row < PARAMS.totalRows - 1; row++) {



      rowColors[row] = rowColors[row + 1];



    }



    rowColors[PARAMS.totalRows - 1] = getRainbowFixedColor(PARAMS.totalRows - 1);



    preventFullRows();



    ensureContinuousScrollSupplyRow();



    continuousScrollOffset -= cellSize;



  }



  worldContainer.y = -continuousScrollOffset;



  virtualScrollY = worldContainer.y;



}



function setWorldY(val: number) {



  const nextWorldY = clampWorldY(val);



  if (worldContainer) worldContainer.y = nextWorldY;



  virtualScrollY = nextWorldY;



}







function getViewportGameHeight(): number {



  const fallback = PARAMS.viewportRows * PARAMS.cellSize;



  const scale = app?.stage?.scale?.y || 1;



  const screenHeight = app?.renderer?.screen?.height || 0;



  if (!Number.isFinite(screenHeight) || screenHeight <= 0 || !Number.isFinite(scale) || scale <= 0) {



    return fallback;



  }



  return Math.max(PARAMS.cellSize, screenHeight / scale - PADDING * 2);



}







function updateBoardViewportMask() {



  if (!boardViewportMask) return;



  boardViewportMask.clear();



  boardViewportMask



    .rect(PADDING, PADDING, PARAMS.gridCols * PARAMS.cellSize, getViewportGameHeight())



    .fill({ color: 0xffffff });



}







function getVisibleTopGameY(worldY: number): number {



  return -worldY;



}







let gameLoopRegistered = false;



function registerGameLoop() {



  if (gameLoopRegistered || !app || !worldContainer) return;



  gameLoopRegistered = true;







  let lastGameLoopAt = performance.now();



  const updateGameLoop = () => {



    const now = performance.now();



    const deltaSec = Math.min(0.2, Math.max(0, (now - lastGameLoopAt) / 1000));



    lastGameLoopAt = now;







    if (!isGameStarted && !isPlayingScript) {



      return;



    }







    if (isGameStarted) {



      gameTime += deltaSec;



      const timeDisplay = document.getElementById('time-display');



      if (timeDisplay) timeDisplay.innerText = gameTime.toFixed(1) + 's';



    }







    if (isGameStarted && getActiveBoardMechanic() === 'scroll') {



      advanceContinuousScroll(deltaSec);



    } else if (isGameStarted && getActiveBoardAdvanceMode() === 'scroll') {



      if (isPlayingAutoGenScript && blocks.length > 0) {



        // ===== Bidirectional proportional speed controller =====



        // Measures headroom (empty space above topmost block).



        //  - headroom > target ?too much empty space ?speed up (max 3×)



        //  - headroom < target ?blocks near top ?slow down (min 0.3×)



        //  - headroom ?target ?base speed (1×)



        // Floor of 0.3× ensures camera never fully stops.



        // This self-regulates so blocks stay ~7/8 fill, operations centered.



        const viewportHeight = getViewportGameHeight();



        const cellSize = PARAMS.cellSize || 50;







        // Find block bounding box



        let topBlockRow = Infinity;



        let bottomBlockRow = -Infinity;



        for (const b of blocks) {



          if (b.row < topBlockRow) topBlockRow = b.row;



          if (b.row > bottomBlockRow) bottomBlockRow = b.row;



        }







        const baseSpeed = PARAMS.scrollSpeed;







        if (topBlockRow !== Infinity) {



          // How much empty space is above the topmost block?



          const viewportTopGameY = -virtualScrollY;



          const topBlockGameY = topBlockRow * cellSize;



          const currentHeadroom = topBlockGameY - viewportTopGameY;



          // Target: topmost block at 1/8 from viewport top



          const targetHeadroom = viewportHeight * 0.125;







          // ratio > 1 ?too much empty space ?speed up



          // ratio < 1 ?blocks near top ?slow down



          // ratio = 0 ?blocks AT top ?0.3× (floor)



          const ratio = currentHeadroom / Math.max(1, targetHeadroom);



          const speedMultiplier = Math.max(0.3, Math.min(3, ratio));







          virtualScrollY -= baseSpeed * speedMultiplier * deltaSec;



        } else {



          virtualScrollY -= baseSpeed * deltaSec;



        }







        const minY = getBottomWorldY();



        if (virtualScrollY < minY) virtualScrollY = minY;



        setWorldY(virtualScrollY);



      } else {



        // Manual play: constant speed scroll



        const targetSpeed = PARAMS.scrollSpeed;



        virtualScrollY -= targetSpeed * deltaSec;



        const minY = getBottomWorldY();



        if (virtualScrollY < minY) {



          virtualScrollY = minY;



        }



        setWorldY(virtualScrollY);



      }



    }







    const minVisibleY = getVisibleTopGameY(worldContainer.y);



    const topBlockReached = blocks.some(b => b.row * PARAMS.cellSize <= minVisibleY + 1);



    const activeBoardMechanic = getActiveBoardMechanic();



    const isGameOver = activeBoardMechanic !== 'scroll'



      && getBoardMechanicBehavior(activeBoardMechanic).failsAtTop



      && !isPlayingAutoGenScript



      && !isPlayingStepTransition



      && !isAnimating



      && topBlockReached;



    if (isGameOver) {



      triggerGameOver(



        `scroll-top topLine=${minVisibleY.toFixed(1)} worldY=${worldContainer.y.toFixed(1)} mode=${getActiveBoardAdvanceMode()}`



      );



    }



  };







  app.ticker.add(() => updateGameLoop());



  window.setInterval(updateGameLoop, 50);



}



function getBottomWorldY(): number {



  return -Math.max(0, PARAMS.totalRows * PARAMS.cellSize - getViewportGameHeight());



}



function clampWorldY(worldY: number): number {



  if (!Number.isFinite(worldY)) return 0;



  const minY = getBottomWorldY();



  return Math.max(minY, Math.min(0, worldY));



}



function getSnappedWorldY(worldY: number = worldContainer ? worldContainer.y : virtualScrollY): number {



  const cellSize = PARAMS.cellSize || 1;



  const minY = getBottomWorldY();



  const snappedY = Math.round(worldY / cellSize) * cellSize;



  return Math.max(minY, Math.min(0, snappedY));



}



function snapWorldYToGrid() {



  setWorldY(getSnappedWorldY());



}



function scrollToBoardBottom() {



  setWorldY(getBottomWorldY());



}



function applyBoardAdvanceMode(mode: BoardAdvanceMode, autoStartScroll = false) {



  boardAdvanceMode = mode;



  if (!isFallingMode && !scriptPlaybackAdvanceMode) {



    boardMechanic = mode;



    localStorage.setItem('boardMechanic', mode);



  }



  localStorage.setItem('boardAdvanceMode', mode);







  if (mode !== 'rising' && worldContainer) {



    const hadPendingRise = pendingRisingRows > 0 || gsap.isTweening(worldContainer);



    stopWorldAdvanceTweens(hadPendingRise);



    if (hadPendingRise) isAnimating = false;



  }







  syncBoardAdvanceFlags(mode);







  if (mode === 'fixed') {



    isGameStarted = false;



  } else if (mode === 'rising') {



    isGameStarted = false;



  } else {



    if (autoStartScroll) {



      setWorldY(worldContainer ? worldContainer.y : virtualScrollY);



      isGameStarted = true;



      gameTime = 0;



      document.getElementById('game-over-text')!.style.display = 'none';



      const btnPlay = document.getElementById('btn-play');



      if (btnPlay) btnPlay.innerHTML = '<span class="icon">⏸</span>暂停游戏';



      const timeDisplay = document.getElementById('time-display');



      if (timeDisplay) timeDisplay.innerText = '0.0s';



    }



  }



}



let blocks: Block[] = [];



let nextBlockId = 1;



let blocksContainer: PIXI.Container;



let holeGraphics: PIXI.Graphics;



let gridGraphics: PIXI.Graphics;



let boardShapeBg: PIXI.Graphics;



let boardBorderGraphics: PIXI.Graphics;



let isAnimating = false;



let shatterTextures: PIXI.Texture[] = [];



let shatterLeftTextures: PIXI.Texture[] = [];



let shatterRightTextures: PIXI.Texture[] = [];



let lastShatterCellColors: Array<{ row: number; col: number; color: string }> = [];



let lastBorderedGemShatters: Array<{ row: number; col: number; color: string; anchorX: number; anchorY: number }> = [];



const borderedGemTextures: Record<string, PIXI.Texture[]> = {};



let rainbowTextures: PIXI.Texture[] = [];



let traditionalTextures: PIXI.Texture[] = [];

type StandaloneEffectFramePayload = {
  type: string;
  sequences: Record<string, string[]>;
};

async function preloadStandaloneSelectedShatterEffects() {
  const payload = (window as any).PLAYABLE_CONFIG?.effectFrames as StandaloneEffectFramePayload | undefined;
  if (!payload?.sequences) return;

  const loadSequence = async (key: string) => {
    const sources = payload.sequences[key] || [];
    const aliases = sources.map((src, index) => {
      const alias = `standalone_effect_${payload.type}_${key}_${index}`;
      PIXI.Assets.add({ alias, src });
      return alias;
    });
    if (aliases.length === 0) return [];
    await PIXI.Assets.load(aliases);
    return aliases
      .map(alias => PIXI.Assets.get<PIXI.Texture>(alias))
      .filter((texture): texture is PIXI.Texture => Boolean(texture));
  };

  if (payload.type === 'default') {
    shatterLeftTextures = await loadSequence('left');
    shatterRightTextures = await loadSequence('right');
  } else if (payload.type === 'bordered-gem') {
    for (const [key] of Object.entries(payload.sequences)) {
      if (!key.startsWith('bordered-')) continue;
      const color = key.slice('bordered-'.length);
      borderedGemTextures[color] = await loadSequence(key);
    }
  } else if (payload.type === 'highlight') {
    rainbowTextures = await loadSequence('highlight');
  } else if (payload.type === 'traditional') {
    traditionalTextures = await loadSequence('traditional');
  } else if (payload.type === 'gem-shatter') {
    for (const [key] of Object.entries(payload.sequences)) {
      if (!key.startsWith('gem-')) continue;
      const color = key.slice('gem-'.length);
      gemShatterTextures[color] = await loadSequence(key);
    }
    gemShatterPreloaded = true;
  }

  // Keeps exported-playable diagnostics independent from Pixi's private cache.
  if (isStandalonePlayable) {
    (window as any).getPlayableEffectAssetStatus = () => ({
      type: payload.type,
      left: shatterLeftTextures.length,
      right: shatterRightTextures.length,
      highlight: rainbowTextures.length,
      traditional: traditionalTextures.length,
      borderedGem: Object.fromEntries(Object.entries(borderedGemTextures).map(([color, textures]) => [color, textures.length])),
      gemShatter: Object.fromEntries(Object.entries(gemShatterTextures).map(([color, textures]) => [color, textures.length])),
    });
  }
}



const blocksThatFell = new Set<number>();



let draggedBlockId: number | null = null;







let holeMask: boolean[][] = [];



let layoutDrawMask: boolean[][] = [];



const NORMAL_LAYOUT_SAVE_VERSION = 2;







function normalizeBooleanMask(



  source: unknown,



  rows: number = PARAMS.totalRows,



  cols: number = PARAMS.gridCols,



  defaultValue = false



): boolean[][] {



  const normalized = Array.from({ length: rows }, () => Array(cols).fill(defaultValue));



  if (!Array.isArray(source)) return normalized;







  for (let r = 0; r < Math.min(rows, source.length); r++) {



    const sourceRow = source[r];



    if (!Array.isArray(sourceRow)) continue;



    for (let c = 0; c < Math.min(cols, sourceRow.length); c++) {



      normalized[r][c] = sourceRow[c] === true;



    }



  }



  return normalized;



}







function normalizeSavedParams(source: unknown): Partial<typeof PARAMS> {



  if (!source || typeof source !== 'object') return {};



  const saved = source as Partial<typeof PARAMS>;



  const normalized: Partial<typeof PARAMS> = {};



  (Object.keys(PARAMS) as Array<keyof typeof PARAMS>).forEach(key => {



    const value = saved[key];



    if (typeof value === typeof PARAMS[key]) {



      (normalized as any)[key] = value;



    }



  });



  return normalized;



}







function loadJsonFromStorage<T>(key: string, label: string): T | null {



  const dataStr = localStorage.getItem(key);



  if (!dataStr) {



    alert(`找不 "${label}"`);



    return null;



  }



  try {



    return JSON.parse(dataStr) as T;



  } catch (err) {



    console.error(`Failed to parse ${label}:`, err);



    alert(`${label}数据解析失败，可能是旧版本存档损坏。`);



    return null;



  }



}







function readSaveNameList(indexKey: string, itemPrefix: string): string[] {



  const names = new Set<string>();



  const savedNamesStr = localStorage.getItem(indexKey);



  if (savedNamesStr) {



    try {



      const parsed = JSON.parse(savedNamesStr);



      if (Array.isArray(parsed)) {



        parsed.forEach(item => {



          if (typeof item === 'string' && item.trim()) names.add(item.trim());



        });



      }



    } catch (err) {



      console.warn(`Ignored invalid ${indexKey}:`, err);



    }



  }







  for (let i = 0; i < localStorage.length; i++) {



    const key = localStorage.key(i);



    if (key?.startsWith(itemPrefix)) {



      const name = key.slice(itemPrefix.length).trim();



      if (name) names.add(name);



    }



  }







  const list = Array.from(names);



  localStorage.setItem(indexKey, JSON.stringify(list));



  return list;



}







function resetHoleMask() {



  const isEditingBoard = (currentMode === 'board-edit');



  const defaultValue = isEditingBoard; // true (blank hole) when editing, false (painted board cell) when playing



  const newHoleMask = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(defaultValue));



  if (holeMask && holeMask.length > 0) {



    for (let r = 0; r < Math.min(PARAMS.totalRows, holeMask.length); r++) {



      if (holeMask[r]) {



        for (let c = 0; c < Math.min(PARAMS.gridCols, holeMask[r].length); c++) {



          newHoleMask[r][c] = holeMask[r][c];



        }



      }



    }



  }



  holeMask = newHoleMask;



  drawHoles();



}







function resetLayoutDrawMask() {



  layoutDrawMask = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(false));



}







// ---- Recording ----



let recorderWebM: MediaRecorder | null = null;



let recordedChunksWebM: Blob[] = [];



let isRecording = false;



let isRecordingArmedForPlayback = false;



let recordingReadyResolver: ((started: boolean) => void) | null = null;



const DIRECT_OUTPUT_RECORDING_FPS = 30;



const TRANSPARENT_RECORDING_FPS = 30;



const DIRECT_OUTPUT_RECORDING_BITRATE = 28_000_000;



const TRANSPARENT_RECORDING_BITRATE = 40_000_000;



interface ManagedRecordingBackground {



  id: string;



  name: string;



  src: string;



  builtin?: boolean;



}



const NO_BACKGROUND_ID = 'none';



const MASTER_BACKGROUND_URL = '/backgrounds/master-bg.png';



const MASTER_BACKGROUND_VERSION = 'master-bg-2026-07-23-v5';



const MASTER_BACKGROUND_ID = 'master';

// Keeps the board frame aligned with the phone background's lower safe area.
const BOARD_FRAME_VERTICAL_SCALE = 1.04;



const MASTER_UI = {



  width: 720,



  height: 1280,



  header: { x: 39 / 720, y: 31 / 1280, w: 642 / 720, h: 103 / 1280 },



  board: { x: 39 / 720, y: 160 / 1280, w: 642 / 720, h: 1088 / 1280 }



};



if (localStorage.getItem('recordingBackgroundMasterVersion') !== MASTER_BACKGROUND_VERSION) {



  localStorage.setItem('recordingBackgroundMasterVersion', MASTER_BACKGROUND_VERSION);



  localStorage.setItem('recordingBackgroundEnabled', 'false');



  localStorage.setItem('recordingBackgroundDataUrl', '');



  localStorage.setItem('recordingBackgroundActiveId', NO_BACKGROUND_ID);



}



let recordingBackgroundEnabled = localStorage.getItem('recordingBackgroundEnabled') === 'true';



let recordingBackgroundDataUrl = localStorage.getItem('recordingBackgroundDataUrl') || '';



let recordingBackgroundActiveId = localStorage.getItem('recordingBackgroundActiveId') || NO_BACKGROUND_ID;



let recordingBackgroundImage: HTMLImageElement | null = null;



let recordingBackgroundImageLoaded = false;







function getRecordingEncoderSettings(useRecordingBackground: boolean) {



  const mimeCandidates = useRecordingBackground



    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']



    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm'];



  return {



    fps: useRecordingBackground ? DIRECT_OUTPUT_RECORDING_FPS : TRANSPARENT_RECORDING_FPS,



    bitrate: useRecordingBackground ? DIRECT_OUTPUT_RECORDING_BITRATE : TRANSPARENT_RECORDING_BITRATE,



    mimeType: mimeCandidates.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm'



  };



}







function setRecordButtonContent(icon: string, firstLine: string, secondLine: string) {



  const btnRecord = document.getElementById('btn-record');



  if (btnRecord) btnRecord.innerHTML = `<span class="icon">${icon}</span>${firstLine}<br>${secondLine}`;



}







function armRecordingForPlayback() {



  if (isRecording || isPlayingScript || scriptSteps.length === 0) return;



  isRecordingArmedForPlayback = true;



  setRecordButtonContent('⏹', '取消', '武装');



}







function cancelArmedRecording() {



  if (!isRecordingArmedForPlayback) return;



  isRecordingArmedForPlayback = false;



  setRecordButtonContent('⏺', '录制', '视频');



}







// ---- Utilities ----



function randomInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }







function getRandomColor() {



  const colors = ['red', 'blue', 'green', 'yellow', 'pink'];



  return colors[randomInt(0, colors.length - 1)];



}







function weightedRandomLength(maxAllowed: number): number {



  const allowedLengths = [1, 2, 3, 4].filter(l => l <= maxAllowed);



  if (allowedLengths.length === 0) return 0;



  let totalWeight = 0;



  for (const l of allowedLengths) totalWeight += PROBS[l as keyof typeof PROBS];



  let r = Math.random() * totalWeight;



  for (const l of allowedLengths) {



    r -= PROBS[l as keyof typeof PROBS];



    if (r <= 0) return l;



  }



  return allowedLengths[allowedLengths.length - 1];



}







// ---- Initialization ----



async function init() {



  app = new PIXI.Application();







  await app.init({



    width: PARAMS.gridCols * PARAMS.cellSize + PADDING * 2,



    height: PARAMS.viewportRows * PARAMS.cellSize + PADDING * 2,



    backgroundAlpha: 0,



    clearBeforeRender: true,



    preserveDrawingBuffer: true,



    resolution: window.devicePixelRatio || 1,



    autoDensity: true,



    antialias: true,



    roundPixels: true



  });







  const boardClip = document.getElementById('board-clip');



  const container = boardClip || document.getElementById('board-wrapper');



  if (boardClip) {



    boardClip.appendChild(app.canvas);



  } else if (container) {



    container.insertBefore(app.canvas, document.getElementById('game-over-text'));



  }







  gameContainer = new PIXI.Container();



  gameContainer.x = PADDING;



  gameContainer.y = PADDING;



  app.stage.addChild(gameContainer);







  boardViewportMask = new PIXI.Graphics();



  app.stage.addChild(boardViewportMask);



  gameContainer.mask = boardViewportMask;



  updateBoardViewportMask();







  worldContainer = new PIXI.Container();



  gameContainer.addChild(worldContainer);







  boardShapeBg = new PIXI.Graphics();



  worldContainer.addChild(boardShapeBg);







  gridGraphics = new PIXI.Graphics();



  worldContainer.addChild(gridGraphics);







  holeGraphics = new PIXI.Graphics();



  worldContainer.addChild(holeGraphics);







  blocksContainer = new PIXI.Container();



  worldContainer.addChild(blocksContainer);







  boardBorderGraphics = new PIXI.Graphics();



  worldContainer.addChild(boardBorderGraphics);







  drawGrid();



  resetHoleMask();



  resetLayoutDrawMask();



  initRowColors();



  setupInteraction();



  setupDOMUI();



  registerGameLoop();







  // The exported HTML is a standalone document. Its block textures are bundled
  // by Vite, while editor-only packs still rely on relative asset paths.
  if (isStandalonePlayable) {
    const playableColors = ['red', 'blue', 'green', 'yellow', 'pink'];
    for (const color of playableColors) {
      for (let length = 1; length <= 4; length++) {
        const assetKey = `../assets/playable-blocks/${color}-${length}.webp`;
        const src = playableBlockAssetsMap[assetKey];
        if (src) PIXI.Assets.add({ alias: `${color}-${length}`, src });
      }
    }
    await PIXI.Assets.load(playableColors.flatMap(color => [1, 2, 3, 4].map(length => `${color}-${length}`)));
    assetsLoaded = true;
    // The standalone file has no editor asset folders at runtime. Load the
    // export-selected shatter frames here, before the authored board is shown.
    await preloadStandaloneSelectedShatterEffects();
  } else {
  // Initialize DBs early in the background



  try {



    await materialDB.init();



    for (const c of ['red', 'blue', 'green', 'yellow', 'pink']) {
      for (let l = 1; l <= 4; l++) {
        const assetKey = `../assets/playable-blocks/${c}-${l}.webp`;
        const src = playableBlockAssetsMap[assetKey] || `assets/playable-blocks/${c}-${l}.webp`;
        PIXI.Assets.add({ alias: `${c}-${l}`, src });
      }
    }

    await preloadAllMaterials();



    await renderMaterialList();



    repairChineseUI();



  } catch (dbErr) {



    console.error('Failed to initialize MaterialDB:', dbErr);



  }







  try {



    await soundDB.init();



    const activeSoundIdStr = localStorage.getItem('activeSoundId');



    let restoredCustomPack = false;



    if (activeSoundIdStr && activeSoundIdStr !== 'default') {



      const activeSoundId = parseInt(activeSoundIdStr);



      const soundsData = await soundDB.getSoundFiles(activeSoundId);



      if (soundsData && Object.keys(soundsData).length > 0) {



        applySoundPack(soundsData);



        restoredCustomPack = true;



      }



    }



    if (!restoredCustomPack) {



      restoreDefaultSounds();



      localStorage.setItem('activeSoundId', 'default');



    }



    await renderSoundList();



    repairChineseUI();



  } catch (dbErr) {



    console.error('Failed to initialize SoundDB:', dbErr);



    restoreDefaultSounds();



    localStorage.setItem('activeSoundId', 'default');



    await renderSoundList();



    repairChineseUI();



  }







  if (isStandalonePlayable) {



    // Exported playables use only the effect selected at export time.



    restoreDefaultEffects();



  } else try {



    await effectDB.init();



    await renderEffectList();



    repairChineseUI();



    const activeEffectIdStr = localStorage.getItem('activeEffectId');



    if (activeEffectIdStr && activeEffectIdStr !== 'default') {



      const activeEffectId = parseInt(activeEffectIdStr);



      const effectData = await effectDB.getEffectFiles(activeEffectId);



      if (effectData) {



        await applyEffectPack(effectData);



      }



    } else {



      restoreDefaultEffects();



    }



  } catch (dbErr) {



    console.error('Failed to initialize EffectDB:', dbErr);



  }







  try {



    await collectibleDB.init();



    await updateActiveCollectible();



    await renderCollectibleList();



    repairChineseUI();



  } catch (dbErr) {



    console.error('Failed to initialize CollectibleDB:', dbErr);



  }







  // Preload Assets in the background



  const colors = ['red', 'blue', 'green', 'yellow', 'pink'];



  for (const c of colors) {



    for (let l = 1; l <= 4; l++) {



      const assetKey = `../assets/playable-blocks/${c}-${l}.webp`;
      PIXI.Assets.add({ alias: `${c}-${l}`, src: playableBlockAssetsMap[assetKey] || `assets/playable-blocks/${c}-${l}.webp` });



    }



  }



  await PIXI.Assets.load(colors.flatMap(c => [1,2,3,4].map(l => `${c}-${l}`)));



  assetsLoaded = true;
  
  console.log("Block textures initialized; layout loading is ready.");







  if (isStandalonePlayable) {
    await preloadStandaloneSelectedShatterEffects();
  } else {
  // Preload Shatter Effects (full-row, legacy)



  for (let i = 0; i <= 44; i++) {



    const frameStr = i.toString().padStart(5, '0');



    PIXI.Assets.add({ alias: `shatter_${i}`, src: `assets/effects/break/1_${frameStr}.png` });



  }



  const shatterAliases = Array.from({ length: 45 }, (_, i) => `shatter_${i}`);



  await PIXI.Assets.load(shatterAliases);



  for (let i = 0; i <= 44; i++) {



    shatterTextures.push(PIXI.Assets.get(`shatter_${i}`));



  }







  // Preload Per-Cell Shatter Effects (left & right)



  for (let i = 0; i <= 43; i++) {



    const frameStr = i.toString().padStart(5, '0');



    PIXI.Assets.add({ alias: `shatter_left_${i}`, src: `assets/effects/break-left/l_${frameStr}.png` });



    PIXI.Assets.add({ alias: `shatter_right_${i}`, src: `assets/effects/break-right/r_${frameStr}.png` });



  }



  const cellShatterAliases = Array.from({ length: 44 }, (_, i) => [`shatter_left_${i}`, `shatter_right_${i}`]).flat();



  await PIXI.Assets.load(cellShatterAliases);



  for (let i = 0; i <= 43; i++) {



    shatterLeftTextures.push(PIXI.Assets.get(`shatter_left_${i}`));



    shatterRightTextures.push(PIXI.Assets.get(`shatter_right_${i}`));



  }







  // Preload the five true-color bordered-gem shatter sequences.



  const borderedGemAliases: string[] = [];



  for (const c of colors) {



    borderedGemTextures[c] = [];



    for (let i = 1; i <= 51; i++) {



      const frameStr = i.toString().padStart(3, '0');



      const alias = `bordered_gem_${c}_${frameStr}`;



      borderedGemAliases.push(alias);



      PIXI.Assets.add({ alias, src: `assets/effects/bordered-gem/${c}/frame_${frameStr}.png` });



    }



  }



  await PIXI.Assets.load(borderedGemAliases);



  for (const c of colors) {



    borderedGemTextures[c] = Array.from({ length: 51 }, (_, i) => {



      const frameStr = (i + 1).toString().padStart(3, '0');



      return PIXI.Assets.get(`bordered_gem_${c}_${frameStr}`);



    });



  }







  // Preload Highlight Effects



  for (let i = 0; i <= 33; i++) {



    const frameStr = i.toString().padStart(2, '0');



    PIXI.Assets.add({ alias: `highlight_${i}`, src: `assets/effects/highlight/highlight_${frameStr}.png` });



  }



  const highlightAliases = Array.from({ length: 34 }, (_, i) => `highlight_${i}`);



  await PIXI.Assets.load(highlightAliases);



  for (let i = 0; i <= 33; i++) {



    rainbowTextures.push(PIXI.Assets.get(`highlight_${i}`));



  }







  // Preload Traditional Effects



  for (let i = 0; i <= 33; i++) {



    const frameStr = i.toString().padStart(2, '0');



    PIXI.Assets.add({ alias: `traditional_${i}`, src: `assets/effects/traditional/Armature_green_${frameStr}.png` });



  }



  const traditionalAliases = Array.from({ length: 34 }, (_, i) => `traditional_${i}`);



  await PIXI.Assets.load(traditionalAliases);



  for (let i = 0; i <= 33; i++) {



    traditionalTextures.push(PIXI.Assets.get(`traditional_${i}`));



  }







  // 棰勭?GPU 绠＄嚎锛氬垱寤洪殣褰?AnimatedSprite 寮哄埗瑙﹀彂绾圭悊涓婁?+ 鐫€鑹插櫒缂栬瘧



  const warmupTexSets = [



    shatterTextures,



    shatterLeftTextures,



    shatterRightTextures,



    ...Object.values(borderedGemTextures),



    rainbowTextures,



    traditionalTextures



  ];



  for (const texSet of warmupTexSets) {



    if (texSet.length === 0) continue;



    const warmup = new PIXI.AnimatedSprite(texSet);



    warmup.alpha = 0.001; // 杩戜箮涓嶅彲瑙佷絾浼氳Е鍙?GPU 娓叉?



    warmup.width = 1;



    warmup.height = 1;



    warmup.gotoAndStop(0);



    app.stage.addChild(warmup);



    // 寮哄埗娓叉煋涓€甯ц GPU 澶勭?



    app.renderer.render(app.stage);



    app.stage.removeChild(warmup);



    warmup.destroy();



  }



  // 棰濆棰勭儹 ColorMatrixFilter锛堥珮鍏夌壒鏁堢敤鍒扮殑鐫€鑹插櫒锛?



  {



    const warmupSprite = new PIXI.AnimatedSprite(rainbowTextures.length > 0 ? rainbowTextures : shatterTextures);



    const cmf = new PIXI.ColorMatrixFilter();



    cmf.brightness(2.5, false);



    warmupSprite.filters = [cmf];



    warmupSprite.alpha = 0.001;



    warmupSprite.width = 1;



    warmupSprite.height = 1;



    app.stage.addChild(warmupSprite);



    app.renderer.render(app.stage);



    app.stage.removeChild(warmupSprite);



    warmupSprite.destroy();



  }







  }

  }

  // Particle system update ticker



  app.ticker.add((ticker) => {



    if (activeParticles.length === 0) return;



    const delta = ticker.deltaTime || 1;



    for (let i = activeParticles.length - 1; i >= 0; i--) {



      const p = activeParticles[i];



      p.sprite.x += p.vx * delta;



      p.sprite.y += p.vy * delta;



      if (p.gravity !== undefined) {



        p.vy += p.gravity * delta;



      }



      if (p.vRot !== undefined) {



        p.sprite.rotation += p.vRot * delta;



      }



      p.sprite.alpha -= p.alphaDecay * delta;



      p.sprite.scale.x -= p.scaleDecay * delta;



      p.sprite.scale.y -= p.scaleDecay * delta;



      if (p.sprite.alpha <= 0 || p.sprite.scale.x <= 0) {



        app.stage.removeChild(p.sprite);



        p.sprite.destroy();



        activeParticles.splice(i, 1);



      }



    }



  });







  if ((window as any).PLAYABLE_CONFIG && (window as any).PLAYABLE_CONFIG.initialState) {
      try {
          const stateData = JSON.parse((window as any).PLAYABLE_CONFIG.initialState);
          (window as any).loadPlayableState(stateData);
          (window as any).__playableLoadedBlockCount = blocks.length;
          if (app?.renderer && app?.stage) app.renderer.render(app.stage);
       } catch(e) {
           console.error("Failed to parse playable state:", e);
           throw e;
       }
  }

  console.log("PIXI Assets initialized and loaded successfully.");



}







function drawGrid() {



  gridGraphics.clear();



  const w = PARAMS.gridCols * PARAMS.cellSize;



  const h = PARAMS.totalRows * PARAMS.cellSize;







  // 浣垮緱鏃犺缂╂斁姣斾緥鏄灏戯紝缁樺埗鍑烘潵鐨勭綉鏍肩嚎鍦ㄥ睆骞曚笂閮芥?1 鐗╃悊鍍忕礌?



  const fitScale = app.stage.scale.x || 1;



  const lineWidth = 1 / fitScale;

  const useGeneratedBackgroundUI =
    recordingBackgroundEnabled &&
    recordingBackgroundActiveId !== MASTER_BACKGROUND_ID &&
    recordingBackgroundActiveId !== NO_BACKGROUND_ID;

  const gridStart = useGeneratedBackgroundUI ? 1 : 0;
  const gridColEnd = useGeneratedBackgroundUI ? PARAMS.gridCols - 1 : PARAMS.gridCols;
  const gridRowEnd = useGeneratedBackgroundUI ? PARAMS.totalRows - 1 : PARAMS.totalRows;







  for (let i = gridStart; i <= gridColEnd; i++) {



    const x = i * PARAMS.cellSize;



    gridGraphics.moveTo(x, 0); gridGraphics.lineTo(x, h);



  }



  for (let i = gridStart; i <= gridRowEnd; i++) {



    const y = i * PARAMS.cellSize;



    gridGraphics.moveTo(0, y); gridGraphics.lineTo(w, y);



  }



  gridGraphics.stroke({
    width: lineWidth,
    color: useGeneratedBackgroundUI ? 0x9aa4d3 : 0xffffff,
    alpha: useGeneratedBackgroundUI ? 0.2 : 0.05
  });



}







function hasCustomBoardShape(): boolean {



  if (!holeMask || holeMask.length === 0) return false;



  for (let r = 0; r < holeMask.length; r++) {



    if (!holeMask[r]) continue;



    for (let c = 0; c < holeMask[r].length; c++) {



      if (holeMask[r][c]) return true;



    }



  }



  return false;



}







function drawBoardShapeBg() {



  boardShapeBg.clear();



  boardBorderGraphics.clear();



  const hasShape = hasCustomBoardShape();







  // Hide global grid when custom shape is active (except during board editing)\n  gridGraphics.visible = !hasShape || currentMode === 'board-edit';











  if (!hasShape && currentMode !== 'board-edit') return;







  const cs = PARAMS.cellSize;







  // Draw 30% black background for valid (non-hole) cells



  for (let r = 0; r < PARAMS.totalRows; r++) {



    for (let c = 0; c < PARAMS.gridCols; c++) {



      if (!holeMask[r] || !holeMask[r][c]) {



        boardShapeBg.rect(c * cs, r * cs, cs, cs);



      }



    }



  }



  boardShapeBg.fill({ color: 0x000000, alpha: 0.3 });







  // Draw grid lines for valid cells



  for (let r = 0; r < PARAMS.totalRows; r++) {



    for (let c = 0; c < PARAMS.gridCols; c++) {



      if (!holeMask[r] || !holeMask[r][c]) {



        boardShapeBg.rect(c * cs, r * cs, cs, cs);



      }



    }



  }



  boardShapeBg.stroke({ width: 1, color: 0xffffff, alpha: 0.15 });







  // Draw an 8px border on the outside of the shape



  const strokeColor = 0x252349;



  const strokeWidth = 8;



  const offset = 4; // 8px / 2 = 4px offset to center the 8px stroke outside the cell







  interface BoundaryEdge {



    x1: number;



    y1: number;



    x2: number;



    y2: number;



    type: 'horiz' | 'vert';



    dx?: number;



    dy?: number;



    used?: boolean;



  }







  // 1. Collect all edges



  const edges: BoundaryEdge[] = [];







  for (let r = 0; r < PARAMS.totalRows; r++) {



    for (let c = 0; c < PARAMS.gridCols; c++) {



      if (!holeMask[r] || !holeMask[r][c]) {



        const x = c * cs;



        const y = r * cs;







        // Top edge



        if (r === 0 || (holeMask[r - 1] && holeMask[r - 1][c])) {



          edges.push({ x1: x, y1: y, x2: x + cs, y2: y, type: 'horiz', dy: -offset });



        }



        // Bottom edge



        if (r === PARAMS.totalRows - 1 || (holeMask[r + 1] && holeMask[r + 1][c])) {



          edges.push({ x1: x + cs, y1: y + cs, x2: x, y2: y + cs, type: 'horiz', dy: offset });



        }



        // Left edge



        if (c === 0 || (holeMask[r] && holeMask[r][c - 1])) {



          edges.push({ x1: x, y1: y + cs, x2: x, y2: y, type: 'vert', dx: -offset });



        }



        // Right edge



        if (c === PARAMS.gridCols - 1 || (holeMask[r] && holeMask[r][c + 1])) {



          edges.push({ x1: x + cs, y1: y, x2: x + cs, y2: y + cs, type: 'vert', dx: offset });



        }



      }



    }



  }







  // 2. Build adjacency map: key -> list of edges starting at key



  const edgeMap = new Map<string, BoundaryEdge[]>();



  for (const e of edges) {



    const key = `${e.x1},${e.y1}`;



    if (!edgeMap.has(key)) {



      edgeMap.set(key, []);



    }



    edgeMap.get(key)!.push(e);



  }







  // 3. Trace loops



  const loops: { x: number; y: number }[][] = [];







  for (const startEdge of edges) {



    if (startEdge.used) continue;







    const currentLoop: { x: number; y: number; dx: number; dy: number }[] = [];



    let curr = startEdge;



    let iterations = 0;



    



    while (curr && !curr.used && iterations < 2000) {



      iterations++;



      curr.used = true;



      



      currentLoop.push({



        x: curr.x1,



        y: curr.y1,



        dx: curr.type === 'vert' ? (curr.dx || 0) : 0,



        dy: curr.type === 'horiz' ? (curr.dy || 0) : 0



      });







      const nextKey = `${curr.x2},${curr.y2}`;



      const candidates = edgeMap.get(nextKey) || [];



      



      // Find the next edge that alternates type and is unused



      const nextEdge = candidates.find(e => !e.used && e.type !== curr.type);



      if (nextEdge) {



        curr = nextEdge;



      } else {



        const fallback = candidates.find(e => !e.used);



        if (fallback) {



          curr = fallback;



        } else {



          break;



        }



      }



    }







    if (currentLoop.length > 0) {



      const resolvedLoop: { x: number; y: number }[] = [];



      const len = currentLoop.length;



      for (let i = 0; i < len; i++) {



        const prev = currentLoop[(i - 1 + len) % len];



        const currNode = currentLoop[i];







        // dx comes from whichever edge is vertical, dy comes from horizontal



        const dx = currNode.dx || prev.dx || 0;



        const dy = currNode.dy || prev.dy || 0;







        resolvedLoop.push({



          x: currNode.x + dx,



          y: currNode.y + dy



        });



      }



      loops.push(resolvedLoop);



    }



  }







  // 4. Draw the closed paths



  for (const loop of loops) {



    if (loop.length < 2) continue;



    boardBorderGraphics.moveTo(loop[0].x, loop[0].y);



    for (let i = 1; i < loop.length; i++) {



      boardBorderGraphics.lineTo(loop[i].x, loop[i].y);



    }



    boardBorderGraphics.closePath();



  }



  boardBorderGraphics.stroke({ width: strokeWidth, color: strokeColor, cap: 'round', join: 'round' });



}







function drawHoles() {



  holeGraphics.clear();







  if (currentMode === 'board-edit') {



    // Board-edit: show VALID (painted) cells with blue overlay



    for (let r = 0; r < PARAMS.totalRows; r++) {



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (!holeMask[r] || !holeMask[r][c]) {



          holeGraphics.rect(c * PARAMS.cellSize + 2, r * PARAMS.cellSize + 2, PARAMS.cellSize - 4, PARAMS.cellSize - 4);



        }



      }



    }



    holeGraphics.fill({ color: 0x3b6bdc, alpha: 0.5 });



  } else if (currentMode === 'draw') {



    // Draw mode: show layout holes (user painted empty spaces) with red overlay



    for (let r = 0; r < PARAMS.totalRows; r++) {



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (layoutDrawMask[r] && layoutDrawMask[r][c]) {



          holeGraphics.rect(c * PARAMS.cellSize + 2, r * PARAMS.cellSize + 2, PARAMS.cellSize - 4, PARAMS.cellSize - 4);



        }



      }



    }



    holeGraphics.fill({ color: 0xc53a5c, alpha: 0.6 });



  }







  // Always update board shape background



  drawBoardShapeBg();



}







// ---- Block Logic ----



function getGridOccupancy(ignoreBlockId: number = -1): number[][] {



  const grid = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(0));



  // Holes count as occupied so irregular rows can be "full"



  // But skip rows that are ENTIRELY holes (they should never be treated as full)



  if (holeMask && holeMask.length > 0) {



    for (let r = 0; r < PARAMS.totalRows; r++) {



      if (!holeMask[r]) continue;



      let hasValidCell = false;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (!holeMask[r][c]) { hasValidCell = true; break; }



      }



      if (!hasValidCell) continue; // Entire row is holes, skip



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (holeMask[r][c]) grid[r][c] = 1;



      }



    }



  }



  blocks.forEach(b => {



    if (b.id === ignoreBlockId) return;



    if (b.row >= 0 && b.row < PARAMS.totalRows) {



      if (b.isProp) {



        // 道具占据全部 length 列（含机器头），确保消除判断正确

        // getPropOccupiedColumns 只返回糖果列，漏掉机器头导致满行永远判断失败



        for (let c = 0; c < b.length; c++) {



          if (b.col + c >= 0 && b.col + c < PARAMS.gridCols) grid[b.row][b.col + c] = 1;



        }



        return;



      }



      for (let c = 0; c < b.length; c++) {



        if (b.col + c >= 0 && b.col + c < PARAMS.gridCols) {



          grid[b.row][b.col + c] = 1;



        }



      }



    }



  });



  return grid;



}







function getHorizontalMoveBounds(block: Block): { minCol: number; maxCol: number } {



  const rowOcc = getGridOccupancy(block.id)[block.row] || [];



  let minCol = 0;



  let maxCol = PARAMS.gridCols - block.length;







  for (let c = block.col - 1; c >= 0; c--) {



    if (rowOcc[c]) {



      minCol = c + 1;



      break;



    }



  }



  for (let c = block.col + block.length; c < PARAMS.gridCols; c++) {



    if (rowOcc[c]) {



      maxCol = c - block.length;



      break;



    }



  }







  return { minCol, maxCol };



}







function canMoveBlockHorizontallyTo(block: Block, targetCol: number): boolean {



  if (!Number.isInteger(targetCol)) return false;



  const { minCol, maxCol } = getHorizontalMoveBounds(block);



  return targetCol >= minCol && targetCol <= maxCol;



}







function getBlockOverlapPairs(): Array<{ first: Block; second: Block }> {



  const overlaps: Array<{ first: Block; second: Block }> = [];



  for (let i = 0; i < blocks.length; i++) {



    for (let j = i + 1; j < blocks.length; j++) {



      const first = blocks[i];



      const second = blocks[j];



      if (



        first.row === second.row &&



        first.col < second.col + second.length &&



        first.col + first.length > second.col



      ) {



        overlaps.push({ first, second });



      }



    }



  }



  return overlaps;



}







function canPlaceBlock(col: number, row: number, length: number): boolean {



  if (col < 0 || col + length > PARAMS.gridCols || row < 0 || row >= PARAMS.totalRows) return false;



  // Check if any cell is a hole (outside board shape)



  if (holeMask && holeMask[row]) {



    for (let c = col; c < col + length; c++) {



      if (holeMask[row][c]) return false;



    }



  }



  return !blocks.some(b => b.row === row && !(b.col + b.length <= col || b.col >= col + length));



}







function initOrUpdateManualPreviewSprite(length: number, color: string, visible: boolean = false, propDir: 'left' | 'right' = 'left') {



  if (color === 'prop-peppermint' || color === 'prop-row-bomb') {



    if (manualPreviewSprite) {



      blocksContainer.removeChild(manualPreviewSprite);



      manualPreviewSprite.destroy();



    }



    const texture = getPropTexture(length, propDir);



    manualPreviewSprite = new PIXI.Sprite(texture);



    blocksContainer.addChild(manualPreviewSprite);



  } else if (color === 'collectible' && activeCollectibleTextures && activeCollectibleTextures.length > 0) {



    if (manualPreviewSprite) {



      blocksContainer.removeChild(manualPreviewSprite);



      manualPreviewSprite.destroy();



    }



    const animSprite = new PIXI.AnimatedSprite(activeCollectibleTextures);



    animSprite.animationSpeed = 0.25;



    animSprite.play();



    manualPreviewSprite = animSprite;



    blocksContainer.addChild(manualPreviewSprite);



  } else {



    if (manualPreviewSprite) {



      blocksContainer.removeChild(manualPreviewSprite);



      manualPreviewSprite.destroy();



    }



    manualPreviewSprite = new PIXI.Sprite();



    blocksContainer.addChild(manualPreviewSprite);



    



    let texture = PIXI.Assets.get(`${color}-${length}`);



    if (color === 'collectible' && activeCollectibleTexture) {



      texture = activeCollectibleTexture;



    }



    if (texture) {



      manualPreviewSprite.texture = texture;



    }



  }



  manualPreviewSprite.width = length * PARAMS.cellSize;



  manualPreviewSprite.height = PARAMS.cellSize;



  manualPreviewSprite.visible = visible;



}







function updateManualPreview(col: number, row: number) {



  if (!manualPreviewSprite || !manualSelectedBlock) return;



  const { length, color } = manualSelectedBlock;



  



  if (color === 'collectible' && activeCollectibleTextures && activeCollectibleTextures.length > 0) {



    if (!(manualPreviewSprite instanceof PIXI.AnimatedSprite)) {



      initOrUpdateManualPreviewSprite(length, color, true);



    } else {



      const animSprite = manualPreviewSprite as PIXI.AnimatedSprite;



      if (animSprite.textures !== activeCollectibleTextures) {



        animSprite.textures = activeCollectibleTextures;



        animSprite.play();



      }



    }



  } else {



    if (manualPreviewSprite instanceof PIXI.AnimatedSprite) {



      initOrUpdateManualPreviewSprite(length, color, true);



    } else {



      let texture = PIXI.Assets.get(`${color}-${length}`);



      if (color === 'collectible' && activeCollectibleTexture) {



        texture = activeCollectibleTexture;



      }



      if (texture) {



        manualPreviewSprite.texture = texture;



      }



    }



  }



  



  manualPreviewSprite.width = length * PARAMS.cellSize;



  manualPreviewSprite.height = PARAMS.cellSize;



  manualPreviewSprite.x = col * PARAMS.cellSize;



  manualPreviewSprite.y = row * PARAMS.cellSize;



  



  if (canPlaceBlock(col, row, length)) {



    manualPreviewSprite.tint = 0x00ff00;



    manualPreviewSprite.alpha = 0.6;



  } else {



    const existing = blocks.find(b => b.row === row && col >= b.col && col < b.col + b.length);



    if (existing) {



      manualPreviewSprite.tint = 0xff3366;



      manualPreviewSprite.alpha = 0.7;



    } else {



      manualPreviewSprite.tint = 0xff0000;



      manualPreviewSprite.alpha = 0.4;



    }



  }



  manualPreviewSprite.visible = true;



}











let propTextureCache: Record<string, PIXI.Texture> = {};
let autoGenScrollSpeed: number | null = null;
let isPlayingAutoGenScript = false;



// Custom prop texture state
let customPropMachineImg: HTMLImageElement | null = null;
let customPropCandyImg: HTMLImageElement | null = null;
let customPropMachineFrames: string[] = [];
let customPropMachineAttackFrames: string[] = [];
let machineIdleTextures: PIXI.Texture[] = [];
let machineAttackTextures: PIXI.Texture[] = [];

const PROP_STORAGE_MACHINE = 'custom_prop_machine_b64';
const PROP_STORAGE_CANDY   = 'custom_prop_candy_b64';
const PROP_STORAGE_MACHINE_FRAMES = 'custom_prop_machine_frames';
const PROP_STORAGE_MACHINE_ATTACK_FRAMES = 'custom_prop_machine_attack_frames';

function invalidatePropCache(): void {
  Object.keys(propTextureCache).forEach(k => { propTextureCache[k].destroy(true); delete propTextureCache[k]; });
  blocks.forEach(b => { if (b.isProp) { const tex = getPropTexture(b.length, b.propDir || 'left'); b.sprite.texture = tex; b.sprite.width = b.length * PARAMS.cellSize; b.sprite.height = PARAMS.cellSize; } });
}

function loadCustomPropImages(): void {
  const cb = localStorage.getItem(PROP_STORAGE_CANDY);
  if (cb) { const i = new Image(); i.onload = () => { customPropCandyImg = i; invalidatePropCache(); }; i.src = cb; }

  const mf = localStorage.getItem(PROP_STORAGE_MACHINE_FRAMES);
  if (mf) { try { customPropMachineFrames = JSON.parse(mf); } catch(e){} }
  
  const maf = localStorage.getItem(PROP_STORAGE_MACHINE_ATTACK_FRAMES);
  if (maf) { try { customPropMachineAttackFrames = JSON.parse(maf); } catch(e){} }

  const mb = localStorage.getItem(PROP_STORAGE_MACHINE); // Legacy fallback
  if (mb && customPropMachineFrames.length === 0) {
    customPropMachineFrames = [mb];
  }

  if (customPropMachineFrames.length > 0 || customPropMachineAttackFrames.length > 0) {
    rebuildMachineTextures();
    invalidatePropCache();
  }
}

function rebuildMachineTextures(): void {
  machineIdleTextures.forEach(t => t.destroy(true));
  machineAttackTextures.forEach(t => t.destroy(true));
  machineIdleTextures = customPropMachineFrames.map(b64 => PIXI.Texture.from(b64));
  machineAttackTextures = customPropMachineAttackFrames.map(b64 => PIXI.Texture.from(b64));
  customPropMachineImg = machineIdleTextures.length > 0 ? (machineIdleTextures[0].baseTexture.resource as any).source as HTMLImageElement : null;
}

function triggerMachineHeadAttack(): void {
  if (machineAttackTextures.length > 0 && machineIdleTextures.length > 0) {
    blocks.forEach(b => {
      if (b.isProp && b.sprite && (b.sprite as any).children && (b.sprite as any).children.length > 1) {
        const head = (b.sprite as any).children[1] as PIXI.AnimatedSprite;
        if (head && head.textures !== machineAttackTextures) {
          head.textures = machineAttackTextures;
          head.animationSpeed = 0.2;
          head.gotoAndPlay(0);
        }
      }
    });
  }
}

function revertMachineHeadIdle(): void {
  if (machineAttackTextures.length > 0 && machineIdleTextures.length > 0) {
    blocks.forEach(b => {
      if (b.isProp && b.sprite && (b.sprite as any).children && (b.sprite as any).children.length > 1) {
        const head = (b.sprite as any).children[1] as PIXI.AnimatedSprite;
        if (head && head.textures === machineAttackTextures) {
          head.textures = machineIdleTextures;
          head.animationSpeed = 0.2;
          head.gotoAndPlay(0);
        }
      }
    });
  }
}

async function importPropImage(role: 'machine' | 'machine_attack' | 'candy'): Promise<void> {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    if (role === 'machine' || role === 'machine_attack') input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []); if (files.length === 0) return resolve();
      // Sort files by name to ensure sequence is in order
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      
      if (role === 'candy') {
        const file = files[0];
        const reader = new FileReader();
        reader.onload = e => {
          const b64 = e.target!.result as string;
          const img = new Image();
          img.onload = () => {
            customPropCandyImg = img; localStorage.setItem(PROP_STORAGE_CANDY, b64);
            invalidatePropCache(); refreshPropStylePanel(); resolve();
          }; img.src = b64;
        }; reader.readAsDataURL(file);
      } else {
        const b64Array: string[] = [];
        for (const file of files) {
          const b64 = await new Promise<string>((res) => {
            const reader = new FileReader();
            reader.onload = e => res(e.target!.result as string);
            reader.readAsDataURL(file);
          });
          b64Array.push(b64);
        }
        
        if (role === 'machine') {
          customPropMachineFrames = b64Array;
          localStorage.setItem(PROP_STORAGE_MACHINE_FRAMES, JSON.stringify(b64Array));
          // For legacy compatibility, save the first frame
          localStorage.setItem(PROP_STORAGE_MACHINE, b64Array[0]); 
        } else if (role === 'machine_attack') {
          customPropMachineAttackFrames = b64Array;
          localStorage.setItem(PROP_STORAGE_MACHINE_ATTACK_FRAMES, JSON.stringify(b64Array));
        }
        
        rebuildMachineTextures();
        invalidatePropCache();
        refreshPropStylePanel();
        resolve();
      }
    }; input.click();
  });
}

function clearCustomPropImages(): void {
  customPropMachineImg = null; customPropCandyImg = null;
  customPropMachineFrames = []; customPropMachineAttackFrames = [];
  machineIdleTextures.forEach(t => t.destroy(true)); machineIdleTextures = [];
  machineAttackTextures.forEach(t => t.destroy(true)); machineAttackTextures = [];
  localStorage.removeItem(PROP_STORAGE_MACHINE); localStorage.removeItem(PROP_STORAGE_CANDY);
  localStorage.removeItem(PROP_STORAGE_MACHINE_FRAMES); localStorage.removeItem(PROP_STORAGE_MACHINE_ATTACK_FRAMES);
  invalidatePropCache(); refreshPropStylePanel();
}

function refreshPropStylePanel(): void {
  const mt  = document.getElementById('prop-machine-thumb')       as HTMLImageElement | null;
  const cma = document.getElementById('prop-machine-attack-thumb') as HTMLImageElement | null;
  const ct  = document.getElementById('prop-candy-thumb')         as HTMLImageElement | null;
  const mp  = document.getElementById('prop-machine-placeholder') as HTMLElement | null;
  const cmap= document.getElementById('prop-machine-attack-placeholder') as HTMLElement | null;
  const cp  = document.getElementById('prop-candy-placeholder')   as HTMLElement | null;
  const btn = document.getElementById('btn-clear-prop-style')     as HTMLButtonElement | null;
  const bdg = document.getElementById('prop-custom-badge')        as HTMLElement | null;
  
  if (mt) { mt.src = customPropMachineFrames[0] || ''; mt.style.display = customPropMachineFrames.length > 0 ? 'block' : 'none'; }
  if (cma) { cma.src = customPropMachineAttackFrames[0] || ''; cma.style.display = customPropMachineAttackFrames.length > 0 ? 'block' : 'none'; }
  if (ct) { ct.src = customPropCandyImg?.src   || ''; ct.style.display = customPropCandyImg   ? 'block' : 'none'; }
  
  if (mp) mp.style.display = customPropMachineFrames.length > 0 ? 'none' : 'block';
  if (cmap) cmap.style.display = customPropMachineAttackFrames.length > 0 ? 'none' : 'block';
  if (cp) cp.style.display = customPropCandyImg   ? 'none' : 'block';
  
  const hasCustom = !!(customPropMachineFrames.length > 0 || customPropMachineAttackFrames.length > 0 || customPropCandyImg);
  if (btn) btn.style.display = hasCustom ? 'inline-block' : 'none';
  if (bdg) bdg.style.display = hasCustom ? 'inline-block' : 'none';
}

function initPropStylePanel(): void {
  const panel = document.getElementById('material-panel');
  if (!panel || document.getElementById('prop-style-section')) return;
  const sec = document.createElement('div');
  sec.id = 'prop-style-section';
  sec.style.cssText = 'display:flex;flex-direction:column;border-top:1px solid #444;padding-top:10px;margin-top:4px;';
  const lbl_title   = '🍬 道具样式';
  const lbl_badge   = '自定义';
  const lbl_candy   = '🍭 糖果体';
  const lbl_machine = '⚙️ 机器头';
  const lbl_clear   = '✕ 恢复默认样式';
  const lbl_hint    = '糖果体图片将<b style="color:#aaa">平铺重复</b>填充；机器头图片固定在右侧 1 格。';
  sec.innerHTML = `<h3 style='margin-top:2px;margin-bottom:4px;display:flex;align-items:center;gap:6px;font-size:14px;'>${lbl_title}<span id='prop-custom-badge' style='display:none;font-size:9px;background:#7c3aed;color:#fff;padding:1px 4px;border-radius:8px;font-weight:600;'>${lbl_badge}</span></h3><div style='display:flex;flex-direction:column;gap:4px;'><div style='display:flex;gap:4px;align-items:center;'><div id='prop-candy-slot' style='flex:1;background:#1e1e2e;border:1px dashed #555;border-radius:6px;padding:4px;text-align:center;cursor:pointer;transition:border-color 0.2s;' onclick='importPropImage("candy")'><div style='font-size:9px;color:#aaa;margin-bottom:2px;'>${lbl_candy}</div><img id='prop-candy-thumb' style='display:none;max-width:100%;max-height:24px;object-fit:contain;border-radius:4px;'/></div><div style='font-size:14px;color:#555;'>→</div><div id='prop-machine-slot' style='flex:1;background:#1e1e2e;border:1px dashed #555;border-radius:6px;padding:4px;text-align:center;cursor:pointer;transition:border-color 0.2s;' onclick='importPropImage("machine")'><div style='font-size:9px;color:#aaa;margin-bottom:2px;'>${lbl_machine}</div><img id='prop-machine-thumb' style='display:none;max-width:100%;max-height:24px;object-fit:contain;border-radius:4px;'/></div></div><button id='btn-clear-prop-style' onclick='clearCustomPropImages()' style='display:none;width:100%;padding:4px;background:#3d1a1a;border:1px solid #7c2d2d;color:#fca5a5;border-radius:4px;cursor:pointer;font-size:10px;'>${lbl_clear}</button><div style='font-size:9px;color:#666;line-height:1.2;'>${lbl_hint}</div></div>`;
  panel.appendChild(sec);
  ['prop-candy-slot','prop-machine-slot'].forEach(id => { const el = document.getElementById(id) as HTMLElement|null; if(!el)return; el.addEventListener('mouseenter',()=>el.style.borderColor='#7c3aed'); el.addEventListener('mouseleave',()=>el.style.borderColor='#555'); });
  refreshPropStylePanel();
}










function animatePropShrink(
  sprite: PIXI.Sprite,
  dir: 'left' | 'right',
  oldCol: number,
  oldLen: number,
  newCol: number,
  newLen: number,
  onComplete?: () => void
) {
  if (!sprite || !sprite.parent) {
    if (onComplete) onComplete();
    return;
  }

  const cellSz = PARAMS.cellSize || 50;
  const machineW = cellSz;
  const startWw = oldLen * cellSz;
  const baseYy = sprite.y;
  
  const rightEdge = oldCol * cellSz + oldLen * cellSz;
  const leftEdge = oldCol * cellSz;

  const shakeDurL = 100;
  const shrinkDurL = 400;
  const fadeDurL = 150;
  const totalDurL = newLen <= 0 ? shakeDurL + shrinkDurL + fadeDurL : shakeDurL + shrinkDurL;
  const startTimeL = performance.now();

  // Create temporary sprites
  const machineSprite = new PIXI.Sprite(getPropTexture(1, dir));
  machineSprite.width = machineW;
  machineSprite.height = cellSz;
  machineSprite.y = baseYy;
  machineSprite.x = dir === 'left' ? rightEdge - machineW : leftEdge;

  const candySprite = new PIXI.Sprite(sprite.texture);
  candySprite.width = startWw;
  candySprite.height = cellSz;
  candySprite.y = baseYy;
  candySprite.x = dir === 'left' ? rightEdge - startWw : leftEdge;

  let shattered = false;

  const mask = new PIXI.Graphics();
  candySprite.mask = mask;

  // Draw initial mask state immediately to prevent a 1-frame invisible flash
  mask.clear();
  mask.beginFill(0xffffff);
  if (dir === 'left') {
    mask.drawRect(rightEdge - startWw, baseYy, startWw, cellSz);
  } else {
    mask.drawRect(leftEdge, baseYy, startWw, cellSz);
  }
  mask.endFill();

  const container = new PIXI.Container();
  container.addChild(candySprite, machineSprite, mask);
  sprite.parent.addChild(container);

  sprite.visible = false;

  function stepLast(now: number) {
    const el = now - startTimeL;
    
    if (el < shakeDurL + shrinkDurL) {
      const t = el / (shakeDurL + shrinkDurL);
      const ease = t; // Linear speed (uniform)
      
      const targetWw = Math.max(newLen * cellSz, machineW);
      const curW = startWw + (targetWw - startWw) * ease;
      
      const shakeIntensity = 1 - ease;
      const shakeX = Math.sin(el * 0.05) * 2 * shakeIntensity;
      const shakeY = Math.cos(el * 0.05) * 1 * shakeIntensity;

      machineSprite.y = baseYy; // Machine head stays perfectly still!
      candySprite.y = baseYy + shakeY;
      machineSprite.x = dir === 'left' ? rightEdge - machineW : leftEdge; // Machine head stays perfectly still!

      let candyX = 0;
      mask.clear();
      mask.beginFill(0xffffff);
      if (dir === 'left') {
        candyX = rightEdge - curW + shakeX;
        candySprite.x = candyX;
        mask.drawRect(candyX, baseYy - 20, Math.max(0, curW - machineW), cellSz + 40); 
      } else {
        candyX = leftEdge - (startWw - curW) + shakeX;
        candySprite.x = candyX;
        mask.drawRect(leftEdge + machineW + shakeX, baseYy - 20, Math.max(0, curW - machineW), cellSz + 40);
      }
      mask.endFill();
      
      requestAnimationFrame(stepLast);
    } else if (el < totalDurL && newLen <= 0) {
      candySprite.visible = false;
      machineSprite.y = baseYy;
      machineSprite.x = dir === 'left' ? rightEdge - machineW : leftEdge;
      machineSprite.alpha = 1 - (el - shakeDurL - shrinkDurL) / fadeDurL;
      
      if (!shattered) {
        shattered = true;
        if (PARAMS.effectType === 'gem-shatter') {
          const texArray = gemShatterTextures['pink'];
          if (texArray && texArray.length > 0 && texArray[0]) {
            const validTexArray = texArray.filter((t: any) => t);
            const anim = new PIXI.AnimatedSprite(validTexArray);
            anim.loop = false;
            anim.animationSpeed = 0.5;
            anim.anchor.set(0.5, 0.226);
            anim.x = machineSprite.x + machineSprite.width / 2;
            anim.y = machineSprite.y + machineSprite.height / 2;
            anim.width = cellSz * 5.5;
            anim.scale.y = anim.scale.x;
            anim.blendMode = 'add';
            anim.rotation = (Math.random() - 0.5) * 0.2;
            anim.onComplete = () => {
              if (anim.parent) anim.parent.removeChild(anim);
              anim.destroy();
            };
            // Add to the same parent as sprite, which is likely blocksContainer
            if (sprite.parent) {
                sprite.parent.addChild(anim);
                anim.play();
            }
          }
        }
      }

      requestAnimationFrame(stepLast);
    } else {
      container.destroy({ children: true });
      if (newLen > 0) {
        sprite.texture = getPropTexture(newLen, dir);
        sprite.width = newLen * cellSz;
        sprite.x = dir === 'left' ? rightEdge - sprite.width : leftEdge;
        sprite.y = baseYy;
        sprite.visible = true;
      }
      if (onComplete) onComplete();
    }
  }
  requestAnimationFrame(stepLast);
}



function getPropTexture(length: number, dir: 'left' | 'right' = 'left'): PIXI.Texture {



  const cellSize = PARAMS.cellSize || 50;



  const useCustom = !!(customPropMachineImg && customPropCandyImg);
  const key = `peppermint_${length}_${dir}_${cellSize}_${useCustom ? 'c' : 'd'}`;
  if (propTextureCache[key]) return propTextureCache[key];

  if (useCustom) {
    const w2 = length * cellSize, h2 = cellSize;
    const cv = document.createElement('canvas'); cv.width = w2; cv.height = h2;
    const cx = cv.getContext('2d')!;
    const machineW = cellSize, candyW = Math.max(0, w2 - machineW);
    if (candyW > 0 && customPropCandyImg) {
      const sc = cellSize / customPropCandyImg.naturalHeight;
      const tw = Math.max(1, Math.ceil(customPropCandyImg.naturalWidth * sc));
      // Scale tile
      const tc = document.createElement('canvas'); tc.width = tw; tc.height = cellSize;
      tc.getContext('2d')!.drawImage(customPropCandyImg, 0, 0, tw, cellSize);
      // Draw all tiles into a full-width candy strip canvas
      const strip = document.createElement('canvas');
      strip.width = candyW; strip.height = cellSize;
      const sCtx = strip.getContext('2d')!;
      for (let dx = 0; dx < candyW; dx += tw) {
        sCtx.drawImage(tc, dx, 0, tw, cellSize);
      }
      // For 'right' dir: flip the ENTIRE strip horizontally so spiral direction reverses
      const candyStartX = dir === 'left' ? 0 : machineW;
      cx.save();
      if (dir === 'right') {
        // translate to where the strip ends, then scale -1 to draw it mirrored
        cx.translate(candyStartX + candyW, 0);
        cx.scale(-1, 1);
        cx.drawImage(strip, 0, 0, candyW, cellSize);
      } else {
        cx.drawImage(strip, candyStartX, 0, candyW, cellSize);
      }
      cx.restore();
    }
    if (customPropMachineImg) {
      const msc = Math.min(machineW / customPropMachineImg.naturalWidth, cellSize / customPropMachineImg.naturalHeight);
      const mW = customPropMachineImg.naturalWidth * msc, mH = customPropMachineImg.naturalHeight * msc;
      const mX = dir === 'left' ? w2 - machineW + (machineW - mW) / 2 : (machineW - mW) / 2;
      const mY = (cellSize - mH) / 2;
      cx.save();
      if (dir === 'right') {
        // Mirror horizontally so the machine head faces the correct direction
        cx.translate(mX + mW, mY);
        cx.scale(-1, 1);
        cx.drawImage(customPropMachineImg, 0, 0, mW, mH);
      } else {
        cx.drawImage(customPropMachineImg, mX, mY, mW, mH);
      }
      cx.restore();
    }
    const t2 = PIXI.Texture.from(cv); propTextureCache[key] = t2; return t2;
  }

  const w = length * cellSize;



  const h = cellSize;



  const canvas = document.createElement('canvas');



  canvas.width = w;



  canvas.height = h;



  const ctx = canvas.getContext('2d')!;







  const machineRadius = h * 0.42;



  const machineCenterX = dir === 'left' ? w - h / 2 : h / 2;



  const machineCenterY = h / 2;







  // 1. Draw Candy Stick Body



  const stickStartX = dir === 'left' ? 4 : h * 0.45;



  const stickEndX = dir === 'left' ? w - h * 0.45 : w - 4;



  const stickW = Math.max(2, stickEndX - stickStartX);



  const stickY = h * 0.12;



  const stickH = h * 0.76;



  const cornerRadius = h * 0.32;







  ctx.save();



  ctx.beginPath();



  ctx.roundRect(stickStartX, stickY, stickW, stickH, cornerRadius);



  ctx.clip();







  // White Base



  ctx.fillStyle = '#fff0f3';



  ctx.fillRect(0, 0, w, h);







  // Red Diagonal Stripes



  ctx.fillStyle = '#e60033';



  const stripeWidth = h * 0.28;



  const stripeGap = h * 0.28;



  const step = stripeWidth + stripeGap;



  const angleOffset = h * 0.45;







  for (let x = -h * 2; x < w + h * 2; x += step) {



    ctx.beginPath();



    ctx.moveTo(x, h);



    ctx.lineTo(x + stripeWidth, h);



    ctx.lineTo(x + stripeWidth + angleOffset, 0);



    ctx.lineTo(x + angleOffset, 0);



    ctx.closePath();



    ctx.fill();



  }







  // Glossy 3D Tube Gradient Overlay



  const gloss = ctx.createLinearGradient(0, stickY, 0, stickY + stickH);



  gloss.addColorStop(0.0, 'rgba(255, 255, 255, 0.85)');



  gloss.addColorStop(0.25, 'rgba(255, 255, 255, 0.25)');



  gloss.addColorStop(0.5, 'rgba(0, 0, 0, 0)');



  gloss.addColorStop(0.85, 'rgba(0, 0, 0, 0.25)');



  gloss.addColorStop(1.0, 'rgba(0, 0, 0, 0.55)');



  ctx.fillStyle = gloss;



  ctx.fillRect(0, 0, w, h);







  ctx.restore();







  // Candy Stick Outer Outline



  ctx.beginPath();



  ctx.roundRect(stickStartX, stickY, stickW, stickH, cornerRadius);



  ctx.lineWidth = 2;



  ctx.strokeStyle = 'rgba(140, 0, 25, 0.7)';



  ctx.stroke();







  // 2. Metallic Connector Ring



  ctx.save();



  const connX = dir === 'left' ? w - h * 0.62 : h * 0.42;



  const connGrad = ctx.createLinearGradient(0, stickY, 0, stickY + stickH);



  connGrad.addColorStop(0, '#e6d8f5');



  connGrad.addColorStop(0.5, '#8a75d5');



  connGrad.addColorStop(1, '#3c2b70');



  ctx.fillStyle = connGrad;



  ctx.beginPath();



  ctx.roundRect(connX, stickY - 2, h * 0.2, stickH + 4, 3);



  ctx.fill();



  ctx.lineWidth = 1.5;



  ctx.strokeStyle = '#27194e';



  ctx.stroke();



  ctx.restore();







  // 3. Machine Launcher Nozzle Head



  ctx.save();



  const machineGrad = ctx.createRadialGradient(



    machineCenterX - 2, machineCenterY - 2, 2,



    machineCenterX, machineCenterY, machineRadius



  );



  machineGrad.addColorStop(0, '#6c5ba7');



  machineGrad.addColorStop(0.7, '#342766');



  machineGrad.addColorStop(1, '#1b1238');







  ctx.fillStyle = machineGrad;



  ctx.beginPath();



  ctx.arc(machineCenterX, machineCenterY, machineRadius, 0, Math.PI * 2);



  ctx.fill();



  ctx.lineWidth = 2.5;



  ctx.strokeStyle = '#b09eff';



  ctx.stroke();







  // Inner Nozzle Ring



  const innerRadius = machineRadius * 0.7;



  ctx.fillStyle = '#221646';



  ctx.beginPath();



  ctx.arc(machineCenterX, machineCenterY, innerRadius, 0, Math.PI * 2);



  ctx.fill();



  ctx.lineWidth = 1.5;



  ctx.strokeStyle = '#d5c9ff';



  ctx.stroke();







  // Center Machine Face/Nozzle Icon



  ctx.fillStyle = '#ffffff';



  ctx.font = `bold ${Math.round(h * 0.36)}px sans-serif`;



  ctx.textAlign = 'center';



  ctx.textBaseline = 'middle';



  ctx.fillText('🤖', machineCenterX, machineCenterY + 1);







  ctx.restore();







  const tex = PIXI.Texture.from(canvas);



  propTextureCache[key] = tex;



  return tex;



}







function spawnBlock(col: number, row: number, length: number, color: string, id?: number, noGravity?: boolean, isCollectible?: boolean, isProp?: boolean, propType?: 'row-bomb' | 'peppermint', propDir: 'left' | 'right' = 'left') {



  if (isProp && !isValidPropLength(length)) return null;



  let sprite: PIXI.Sprite;



  if (isProp) {



    // Prop blocks use a dynamically generated texture



    const texture = getPropTexture(length, propDir);



    sprite = new PIXI.Sprite(texture);



  } else if (isCollectible && activeCollectibleTextures && activeCollectibleTextures.length > 0) {



    const animSprite = new PIXI.AnimatedSprite(activeCollectibleTextures);



    animSprite.animationSpeed = 0.25;



    animSprite.play();



    sprite = animSprite;



  } else {



    let texture: PIXI.Texture | null = null;



    if (isCollectible && activeCollectibleTexture) {



      texture = activeCollectibleTexture;



    } else {



      texture = PIXI.Assets.get(`${color}-${length}`);



    }



    if (!texture) {
      try {
        const fallbackG = new PIXI.Graphics();
        const colorHexMap: Record<string, number> = {
          red: 0xee5253, blue: 0x2e86de, green: 0x10ac84, yellow: 0xff9f43, pink: 0xf368e0,
          purple: 0x9b59b6, cyan: 0x00d2d3, orange: 0xff9f43
        };
        const hex = colorHexMap[color] || 0xee5253;
        fallbackG.roundRect(2, 2, length * PARAMS.cellSize - 4, PARAMS.cellSize - 4, 8);
        fallbackG.fill({ color: hex });
        fallbackG.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
        texture = app.renderer.generateTexture(fallbackG);
      } catch(e) {}
    }

    if (!texture) return null;



    sprite = new PIXI.Sprite(texture);



  }



  sprite.width = length * PARAMS.cellSize;



  sprite.height = PARAMS.cellSize;



  sprite.x = col * PARAMS.cellSize;



  sprite.y = row * PARAMS.cellSize;







  if (isProp) {



    sprite.eventMode = 'none';



    sprite.cursor = 'default';



  } else {



    sprite.eventMode = 'dynamic';



    sprite.cursor = 'grab';



  }







  let isDragging = false;



  let dragStartPointerX = 0;



  let dragStartX = 0;



  let minCol = 0;



  let maxCol = PARAMS.gridCols - length;







  sprite.on('pointerdown', (e) => {



    if (currentMode !== 'play' || isAnimating) return;



    playSound(sounds.spawn);



    isDragging = true;



    sprite.cursor = 'grabbing';



    dragStartPointerX = e.global.x;



    dragStartX = sprite.x;







    // Brighten selected block



    const brightFilter = new PIXI.ColorMatrixFilter();



    brightFilter.brightness(2.8, false);



    sprite.filters = [brightFilter];







    const bounds = getHorizontalMoveBounds(block);



    minCol = bounds.minCol;



    maxCol = bounds.maxCol;



  });







  app.stage.on('pointermove', (e) => {



    if (!isDragging) return;



    let newX = dragStartX + (e.global.x - dragStartPointerX);



    newX = Math.max(minCol * PARAMS.cellSize, Math.min(newX, maxCol * PARAMS.cellSize));



    sprite.x = newX;



  });







  const stopDrag = () => {



    if (!isDragging) return;



    isDragging = false;



    sprite.cursor = 'grab';



    // Remove brightness filter



    sprite.filters = [];







    const newCol = Math.round(sprite.x / PARAMS.cellSize);



    sprite.x = newCol * PARAMS.cellSize;







    if (newCol !== block.col) {



      const oldCol = block.col;



      block.col = newCol;



      block.noGravity = false;
      
      // TRACK SWIPE FOR PLAYABLE
      playableSwipes++;
      if (typeof (window as any).checkPlayableLimits === 'function') (window as any).checkPlayableLimits();

      releaseVisibleNoGravityBlocks();

      hasAnyEliminationThisStep = false;

      risingEliminationWavesThisMove = 0;



      draggedBlockId = block.id;

      if (isRisingAdvanceActive()) {
        pendingRisingRows = getRisingRowsForCompletedMove(risingEliminationWavesThisMove);
      }



      blocksThatFell.clear();



      blocksThatFell.add(block.id);







      if (isRecordingSteps) {



        const recordedStepIndex = scriptSteps.length;



        scriptSteps.push({



          blockId: block.id,



          fromCol: oldCol,



          row: block.row,



          toCol: newCol,



          scrollY: worldContainer.y,



          scrollRow: getScrollRowFromWorldY(worldContainer.y),



          gravityMaxRow: getRuntimeGravityMaxRow(worldContainer.y),



          eliminatedRows: [],



          eliminationWaves: []



        });



        activeRecordingStepIndex = recordedStepIndex;



        updateScriptUI();



        applyGravity();



        void waitForPhysics().then(() => {



          if (scriptSteps[recordedStepIndex]) {



            updateScriptUI();



          }



        });



      } else if (selectedStepIndex !== null) {



        scriptSteps[selectedStepIndex].toCol = newCol;



        setStepScrollFromWorldY(scriptSteps[selectedStepIndex], worldContainer.y);



        scriptSteps[selectedStepIndex].gravityMaxRow = getRuntimeGravityMaxRow(worldContainer.y);



        repairScriptSteps();



        runPhysicsInstant();



        updateScriptUI();



      } else {

        // A playable move resolves an immediately completed row before gravity.
        // This keeps the live interaction aligned with the tutorial: the player
        // slides a block into a full row, then that row clears.
        if (isStandalonePlayable && getImmediatePlayableFullRows().length > 0) {
          checkEliminations();
        } else {
          applyGravity();
        }



      }







      if (isGameplayMode) {



        resetGameplayTimer();



      }



    }



  };







  app.stage.on('pointerup', stopDrag);



  app.stage.on('pointerupoutside', stopDrag);







  const blockId = id !== undefined ? id : nextBlockId++;



  if (id !== undefined && id >= nextBlockId) {



    nextBlockId = id + 1;



  }







  const block: Block = { id: blockId, col, row, length, color, sprite, noGravity, isCollectible, isProp, propType, propDir };



  blocksContainer.addChild(sprite);



  blocks.push(block);



  return block;



}







function clearAllBlocks() {



  blocks.forEach(b => blocksContainer.removeChild(b.sprite));



  blocks = [];



  nextBlockId = 1; // Reset block ID counter to keep IDs fully deterministic across restores



}



if (new URLSearchParams(window.location.search).has('prop-test')) {

  const stateNode = document.createElement('pre');

  stateNode.id = 'prop-test-state';

  stateNode.style.display = 'none';

  document.body.appendChild(stateNode);

  window.setInterval(() => {

    stateNode.textContent = JSON.stringify(blocks

      .filter(block => block.isProp)

      .map(block => ({

        id: block.id,

        col: block.col,

        row: block.row,

        length: block.length,

        spriteWidth: block.sprite.width,

        spriteX: block.sprite.x,

        spriteY: block.sprite.y,

        hasParent: Boolean(block.sprite.parent),

      })));

  }, 50);

}







// ---- Physics ----



function areBlocksTouching(b1: Block, b2: Block, b1Row: number = b1.row, b2Row: number = b2.row): boolean {



  const verticalOverlap = b1.col < b2.col + b2.length && b1.col + b1.length > b2.col;



  const verticalTouch = Math.abs(b1Row - b2Row) === 1 && verticalOverlap;



  const horizontalTouch = b1Row === b2Row && (b1.col + b1.length === b2.col || b2.col + b2.length === b1.col);



  return verticalTouch || horizontalTouch;



}







function detectFloatingBlocks() {



  blocks.forEach(b => b.noGravity = false);







  const sortedForSim = [...blocks].sort((a, b) => b.row - a.row);



  const simulatedRows: Record<number, number> = {};







  sortedForSim.forEach(b => {



    let targetRow = b.row;



    while (targetRow < PARAMS.totalRows - 1) {



      let canDrop = true;



      for (const other of blocks) {



        if (other.id === b.id) continue;



        const otherRow = simulatedRows[other.id] !== undefined ? simulatedRows[other.id] : other.row;



        if (otherRow === targetRow + 1) {



          if (b.col < other.col + other.length && b.col + b.length > other.col) { canDrop = false; break; }



        }



      }



      if (canDrop) targetRow++;



      else break;



    }



    simulatedRows[b.id] = targetRow;



  });







  blocks.forEach(b => {



    if (simulatedRows[b.id] !== b.row) {



      b.noGravity = true;



    }



  });



}







function resolveNoGravityStates() {



  let changed = true;



  let safety = 0;



  while (changed && safety < 100) {



    changed = false;



    safety++;







    const simulatedRows: Record<number, number> = {};



    const sortedForSim = [...blocks].sort((a, b) => b.row - a.row);



    sortedForSim.forEach(b => {



      let targetRow = b.row;



      if (b.noGravity) {



        simulatedRows[b.id] = targetRow;



        return;



      }



      while (targetRow < PARAMS.totalRows - 1) {



        let canDrop = true;



        for (const other of blocks) {



          if (other.id === b.id) continue;



          const otherRow = simulatedRows[other.id] !== undefined ? simulatedRows[other.id] : other.row;



          if (otherRow === targetRow + 1) {



            if (b.col < other.col + other.length && b.col + b.length > other.col) { canDrop = false; break; }



          }



        }



        if (canDrop) targetRow++;



        else break;



      }



      simulatedRows[b.id] = targetRow;



    });







    for (const b of blocks) {



      if (b.noGravity) {



        for (const other of blocks) {



          if (other.id === b.id || other.noGravity) continue;



          const otherRow = simulatedRows[other.id];







          if (areBlocksTouching(b, other, b.row, otherRow)) {



            b.noGravity = false;



            changed = true;



            break;



          }



        }



        if (changed) break;



      }



    }



  }



}







function releaseVisibleNoGravityBlocks(viewportY: number = worldContainer.y, maxRowOverride?: number) {



  if (!isNoGravityMode) return;







  const minVisibleRow = Math.max(0, Math.floor(-viewportY / PARAMS.cellSize));



  const visibleMaxRow = Math.min(



    PARAMS.totalRows - 1,



    Math.floor((-viewportY + getViewportGameHeight() - 1) / PARAMS.cellSize)



  );



  const maxVisibleRow = Math.min(



    PARAMS.totalRows - 1,



    Math.max(



      visibleMaxRow,



      Number.isFinite(maxRowOverride) ? Math.floor(maxRowOverride!) : visibleMaxRow



    )



  );







  blocks.forEach(b => {



    if (b.row >= minVisibleRow && b.row <= maxVisibleRow) {



      b.noGravity = false;



    }



  });



}







function riseOneRow() {



  if (!isRisingAdvanceActive() || scriptPlaybackStopRequested) {



    pendingRisingRows = 0;



    isAnimating = false;



    return;



  }







  // A discrete rise needs one full row of headroom before the board advances.



  if (blocks.some(b => b.row <= 0)) {



    pendingRisingRows = 0;



    isAnimating = false;



    triggerGameOver('rising-top');



    return;



  }







  pendingRisingRows--;



  isAnimating = true;



  const targetY = -PARAMS.cellSize;
  const supplyPlan = getRisingSupplyRowPlan(PARAMS.totalRows);

  // Create the next row below the viewport before the rise animation starts.
  // The world tween carries it into view instead of popping it in at the end.
  spawnFallingSupplyRow(supplyPlan.spawnRow, supplyPlan.finalRow);







  gsap.to(worldContainer, {



    y: targetY,



    duration: 0.3,



    ease: 'power2.out',



    onUpdate: () => {



      virtualScrollY = worldContainer.y;



    },



    onComplete: () => {



      blocks.forEach(b => {



        b.row -= 1;



        b.sprite.y = b.row * PARAMS.cellSize;



      });



      for (let row = 0; row < PARAMS.totalRows - 1; row++) {



        rowColors[row] = rowColors[row + 1];



      }



      rowColors[PARAMS.totalRows - 1] = getRainbowFixedColor(PARAMS.totalRows - 1);



      preventFullRows();



      worldContainer.y = 0;



      virtualScrollY = 0;







      if (isRisingAdvanceActive() && pendingRisingRows > 0 && !scriptPlaybackStopRequested) {



        riseOneRow();



      } else {



        // Rising done ?step complete, don't re-trigger physics chain'



        isAnimating = false;



        blocksThatFell.clear();



        draggedBlockId = null;



        activeRecordingStepIndex = null;



      }



    }



  });



}







function afterGravityComplete(checkElim: boolean) {



  if (checkElim) {



    checkEliminations();



  } else {



    isAnimating = false;



  }



}







function applyGravity(checkElim: boolean = true) {



  if (isAnimating) return;







  if (isNoGravityMode) resolveNoGravityStates();







  // In rising mode, only apply gravity to blocks within/above the visible viewport



  // Blocks below the viewport are waiting to scroll in and should stay in place



  const maxGravityRow = getActivePhysicsMaxRow();







  blocks.sort((a, b) => b.row - a.row);







  const simulatedRows: Record<number, number> = {};



  



  blocks.forEach(b => {



    let targetRow = b.row;



    if (isNoGravityMode && b.noGravity) {



      simulatedRows[b.id] = targetRow;



      return;



    }



    if (b.row > maxGravityRow) {



      simulatedRows[b.id] = targetRow;



      return;



    }



    while (targetRow < maxGravityRow) {



      let canDrop = true;



      if (holeMask && holeMask[targetRow + 1]) {



        for (let c = b.col; c < b.col + b.length; c++) {



          if (holeMask[targetRow + 1][c]) { canDrop = false; break; }



        }



      }



      if (canDrop) {



        for (const other of blocks) {



          if (other.id === b.id) continue;



          const otherRow = simulatedRows[other.id] !== undefined ? simulatedRows[other.id] : other.row;



          if (otherRow === targetRow + 1) {



            if (b.col < other.col + other.length && b.col + b.length > other.col) { canDrop = false; break; }



          }



        }



      }



      if (canDrop) targetRow++;



      else break;



    }



    simulatedRows[b.id] = targetRow;



  });







  const simulatedOcc = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(0));



  if (holeMask && holeMask.length > 0) {



    for (let r = 0; r < PARAMS.totalRows; r++) {



      if (!holeMask[r]) continue;



      let hasValidCell = false;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (!holeMask[r][c]) { hasValidCell = true; break; }



      }



      if (!hasValidCell) continue;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (holeMask[r][c]) simulatedOcc[r][c] = 1;



      }



    }



  }



  blocks.forEach(b => {



    const row = simulatedRows[b.id];



    if (row < 0 || row >= PARAMS.totalRows) return;



    for (let c = 0; c < b.length; c++) {



      if (b.col + c >= 0 && b.col + c < PARAMS.gridCols) {



        simulatedOcc[row][b.col + c] = 1;



      }



    }



  });







  let willEliminate = false;



  if (activeSimulatingStepIndex !== null && !isRepairingScript) {



    const step = scriptSteps[activeSimulatingStepIndex];



    const allowed = getPlaybackAllowedRows(step);



    for (let r = 0; r < PARAMS.totalRows; r++) {



      let isFull = true;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (simulatedOcc[r][c] === 0) { isFull = false; break; }



      }



      if (isFull && allowed.includes(r)) {



        willEliminate = true;



        break;



      }



    }



  } else {



    const minVisibleY = -worldContainer.y;



    const minRow = Math.max(0, Math.floor(minVisibleY / PARAMS.cellSize));



    const maxRow = getVisibleBottomRowForWorldY(worldContainer.y);







    for (let r = minRow; r <= maxRow; r++) {



      let isFull = true;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (simulatedOcc[r][c] === 0) { isFull = false; break; }



      }



      if (isFull) {



        willEliminate = true;



        break;



      }



    }



  }







  // Calculate if any blocks actually fell



  const droppedAny = blocks.some(b => simulatedRows[b.id] !== b.row);







  if (droppedAny) {



    // Re-sort and actually apply drops with animation



    blocks.sort((a, b) => b.row - a.row);



    isAnimating = true;







    const tl = gsap.timeline({



      onComplete: () => {



        afterGravityComplete(checkElim);



      }



    });







    blocks.forEach(b => {



      const targetR = simulatedRows[b.id];



      if (targetR !== undefined && targetR !== b.row) {



        b.row = targetR;



        blocksThatFell.add(b.id);



        tl.to(b.sprite, {



          y: targetR * PARAMS.cellSize,



          duration: PARAMS.gravityDuration,



          ease: 'power2.in',



          onComplete: () => {



            if (isRainbowFixedMode) {



              const newColor = rowColors[targetR];



              if (b.color !== newColor) {



                b.color = newColor;



                const texture = PIXI.Assets.get(`${newColor}-${b.length}`);



                if (texture) b.sprite.texture = texture;



              }



            }



          }



        }, 0);



      }



    });







    if (!willEliminate) {



      const soundDelay = Math.max(0, PARAMS.gravityDuration - 0.15);



      tl.call(() => {



        playSound(sounds.fall);



      }, [], soundDelay);



    }



  } else {



    // No blocks dropped ?handle post-gravity directly (no timeline created)



    afterGravityComplete(checkElim);



  }



}







function playRowShatterEffect(row: number, color: string, rowBlocks: Block[] = [], skipCols: Set<number> = new Set()) {

  // For continuous beam effects (mode 3 and 4), do not skip any columns so the beam passes over props
  if (PARAMS.shatterMode === 3 || PARAMS.shatterMode === 4) {
    skipCols = new Set();
  }

  const isHideShatter = (document.getElementById('input-hideshatter') as HTMLInputElement)?.checked || false;



  if (isHideShatter) return;







  const selectShatterColor = (document.getElementById('select-shatter-color') as HTMLSelectElement)?.value || 'default';



  const useIndividualBlockColors = selectShatterColor === 'multicolor';



  if (selectShatterColor !== 'default' && !useIndividualBlockColors) {



    color = selectShatterColor;



  }







  const getShatterColorAtColumn = (col: number) => {



    if (!useIndividualBlockColors) return color;



    const sourceBlock = rowBlocks.find(block => col >= block.col && col < block.col + block.length);



    return sourceBlock?.color || color;



  };







  const effectType = PARAMS.effectType || 'default';



  lastBorderedGemShatters = [];



  



  let texturesToUse = shatterTextures;



  let isCustomRow = false;



  let isHighlight = false;



  



  if (activeEffectTextures.length > 0 && effectType !== 'default' && effectType !== 'bordered-gem') {



    texturesToUse = activeEffectTextures;



    isCustomRow = true;



  } else if (effectType === 'highlight' && rainbowTextures.length > 0) {



    texturesToUse = rainbowTextures;



    isHighlight = true;



  } else if (effectType === 'traditional' && traditionalTextures.length > 0) {



    texturesToUse = traditionalTextures;



    isHighlight = true;



  }



  



  const hasNativeEffectFrames = effectType === 'default'
    ? shatterLeftTextures.length > 0 && shatterRightTextures.length > 0
    : effectType === 'bordered-gem'
      ? Object.values(borderedGemTextures).some(textures => textures.length > 0)
      : false;
  if (texturesToUse.length === 0 && activeEffectTextures.length === 0 && !hasNativeEffectFrames) return;



  



  // Find valid columns in this row to determine the actual board width and offset



  let minCol = 0;



  let maxCol = PARAMS.gridCols - 1;



  if (holeMask && holeMask[row]) {



    let found = false;



    for (let c = 0; c < PARAMS.gridCols; c++) {



      if (!holeMask[row][c]) {



        if (!found) { minCol = c; found = true; }



        maxCol = c;



      }



    }



  }



  const totalValidCols = maxCol - minCol + 1;



  const boardRowWidth = totalValidCols * PARAMS.cellSize;



  const boardRowCenterX = (minCol + maxCol + 1) * PARAMS.cellSize / 2;







  for (let col = minCol; col <= maxCol; col++) {
    if (skipCols.has(col)) continue; // skip prop columns



    lastShatterCellColors.push({ row, col, color: getShatterColorAtColumn(col) });



  }







  if (effectType === 'bordered-gem') {



    const mode = PARAMS.shatterMode || 1;



    const centerCol = PARAMS.gridCols / 2;



    const totalStagger = mode === 2 ? 0 : 0.5;



    const maxDist = (mode === 3 || mode === 4) ? PARAMS.gridCols - 1 : Math.ceil(PARAMS.gridCols / 2);



    const staggerPerCell = maxDist > 0 ? totalStagger / maxDist : 0;







    for (let col = minCol; col <= maxCol; col++) {



      const sourceBlock = rowBlocks.find(block => col >= block.col && col < block.col + block.length);



      const cellColor = selectShatterColor === 'multicolor'



        ? (sourceBlock?.color || color)



        : color;



      const textures = borderedGemTextures[cellColor] || borderedGemTextures.pink;



      if (!textures || textures.length === 0) continue;







      const refCol = col + 0.5;



      let delay = 0;



      if (mode === 3) {



        delay = col * staggerPerCell * 1000;



      } else if (mode === 4) {



        delay = (PARAMS.gridCols - 1 - col) * staggerPerCell * 1000;



      } else if (mode === 1) {



        delay = Math.abs(refCol - centerCol) * staggerPerCell * 1000;



      }







      setTimeout(() => {



        const cellAnim = new PIXI.AnimatedSprite(textures);



        // The source gem center is (1086, 464.5). Frames are uniformly cropped



        // and rendered at half resolution, so this anchor keeps it on the cell.



        const anchorX = (1086 - 358) / 1424;



        const anchorY = (464.5 - 383) / 2777;



        cellAnim.anchor.set(anchorX, anchorY);



        cellAnim.x = (col + 0.5) * PARAMS.cellSize;



        cellAnim.y = (row + 0.5) * PARAMS.cellSize;



        cellAnim.width = PARAMS.cellSize * (712 / 57);



        cellAnim.height = PARAMS.cellSize * (1389 / 57);



        cellAnim.loop = false;



        cellAnim.animationSpeed = 51 / 60;



        lastBorderedGemShatters.push({ row, col, color: cellColor, anchorX, anchorY });



        worldContainer.addChild(cellAnim);



        cellAnim.play();



        cellAnim.onComplete = () => {



          worldContainer.removeChild(cellAnim);



          cellAnim.destroy();



        };



      }, delay);



    }



  } else if (isHighlight) {



    const playHighlightSegment = (effectColor: string, clipBlock?: Block) => {



      const anim = new PIXI.AnimatedSprite(texturesToUse);



      // 居中对齐，中间方?849x107)对齐网格宽度和行高，发光自然溢出



      anim.anchor.set(514 / 1039, 97 / 187); // 方框中心 (x=514, y=97)



      anim.x = boardRowCenterX;



      anim.y = (row + 0.5) * PARAMS.cellSize;



      const rowWidth = boardRowWidth;



      // 宽度：方?849px)对齐网格宽度



      anim.width = rowWidth * (1039 / 849);



      // 高度：方?107px)对齐单行高度(cellSize)



      anim.height = PARAMS.cellSize * (187 / 107);



      anim.loop = false;



      anim.animationSpeed = 1.0;







      // 设置为滤色，相加混合模式，使图片像素和下方背景颜色相叠加，产生透亮发光?



      anim.blendMode = 'add';







      // 消除高光原始材质是绿色的，需要根据实际方块颜色做相对旋转



      const shiftMap: Record<string, number> = {



        pink: 180,



        red: -120,



        yellow: -60,



        green: 0,



        blue: 120



      };



      const filter = new PIXI.ColorMatrixFilter();



      filter.hue(shiftMap[effectColor] || 0, false);







      // 大幅增加亮度，让高光更加明亮透亮



      const brightFilter = new PIXI.ColorMatrixFilter();



      brightFilter.brightness(2.5, false);







      anim.filters = [filter, brightFilter];



      anim.alpha = 0.9;







      let clipMask: PIXI.Graphics | null = null;



      if (clipBlock) {



        clipMask = new PIXI.Graphics();



        clipMask.rect(



          clipBlock.col * PARAMS.cellSize,



          row * PARAMS.cellSize,



          clipBlock.length * PARAMS.cellSize,



          PARAMS.cellSize



        );



        clipMask.fill({ color: 0xffffff });



        worldContainer.addChild(clipMask);



        anim.mask = clipMask;



      }







      worldContainer.addChild(anim);



      anim.play();



      anim.onComplete = () => {



        worldContainer.removeChild(anim);



        anim.destroy();



        if (clipMask) {



          worldContainer.removeChild(clipMask);



          clipMask.destroy();



        }



      };



    };







    if (useIndividualBlockColors && rowBlocks.length > 0) {



      rowBlocks.forEach(block => playHighlightSegment(block.color, block));



    } else {



      playHighlightSegment(color);



    }



  } else if (isCustomRow) {



    const anim = new PIXI.AnimatedSprite(texturesToUse);



    // 居中对齐，并保持彩虹消除原始长宽?20:375，避免画面拉伸变?



    anim.anchor.set(0.5, 0.5);



    anim.x = boardRowCenterX;



    anim.y = (row + 0.5) * PARAMS.cellSize;



    anim.width = boardRowWidth;



    anim.height = anim.width * (375 / 720); // ?00px 时高~260px



    anim.loop = false;



    anim.animationSpeed = 1.0;



    



    worldContainer.addChild(anim);



    anim.play();



    anim.onComplete = () => {



      worldContainer.removeChild(anim);



      anim.destroy();



    };



  } else {



    // 逐格破碎效果 (默认)



    const isCustomCell = activeEffectTextures.length > 0;



    if (!isCustomCell && (shatterLeftTextures.length === 0 || shatterRightTextures.length === 0)) return;







    const mode = PARAMS.shatterMode || 1;



    const centerCol = PARAMS.gridCols / 2;







    // 根据模式计算 stagger 总时?



    const totalStagger = (mode === 2) ? 0 : 0.5;



    const maxDist = (mode === 3 || mode === 4) ? (PARAMS.gridCols - 1) : Math.ceil(PARAMS.gridCols / 2);



    const staggerPerCell = maxDist > 0 ? totalStagger / maxDist : 0;







    // 根据填充块的颜色修改色相与饱和度



    const colorParams: Record<string, { hue: number; saturate: number }> = {



      pink: { hue: 0, saturate: 0 },



      red: { hue: 41, saturate: 0.4 },



      yellow: { hue: 80, saturate: 0.4 },



      green: { hue: 164, saturate: 0.2 },



      blue: { hue: 252, saturate: 0.2 }



    };







    for (let col = minCol; col <= maxCol; col++) {







      // 根据模式选择纹理和延?



      let textures: PIXI.Texture[];



      let isLeftTex: boolean;



      let delay: number;







      const refCol = col + 0.5;







      if (isCustomCell) {



        textures = activeEffectTextures;



        isLeftTex = refCol < centerCol;



        if (mode === 3) {



          delay = col * staggerPerCell * 1000;



        } else if (mode === 4) {



          delay = (PARAMS.gridCols - 1 - col) * staggerPerCell * 1000;



        } else {



          const dist = isLeftTex ? (centerCol - refCol) : (refCol - centerCol);



          delay = Math.max(0, dist) * staggerPerCell * 1000;



        }



      } else {



        if (mode === 3) {



          // 从左到右：全部用右侧纹理，按从左到右顺序 stagger



          textures = shatterRightTextures.slice(3);



          isLeftTex = false;



          delay = col * staggerPerCell * 1000;



        } else if (mode === 4) {



          // 从右到左：全部用左侧纹理，按从右到左顺序 stagger



          textures = shatterLeftTextures.slice(3);



          isLeftTex = true;



          delay = (PARAMS.gridCols - 1 - col) * staggerPerCell * 1000;



        } else {



          // Mode 1（从中间往两边）或 Mode 2（同时）



          isLeftTex = refCol < centerCol;



          textures = isLeftTex ? shatterLeftTextures.slice(3) : shatterRightTextures.slice(3);



          const dist = isLeftTex ? (centerCol - refCol) : (refCol - centerCol);



          delay = Math.max(0, dist) * staggerPerCell * 1000;



        }



      }







      setTimeout(() => {



        const cellAnim = new PIXI.AnimatedSprite(textures);



        if (isCustomCell) {



          const firstTex = textures[0];



          const texW = firstTex ? firstTex.width : 2048;



          const texH = firstTex ? firstTex.height : 3660;



          const aspect = texH / texW;



          



          // 如果高宽比接?1.787（默认原版比例），说明用户使用的是原版格式的序列?



          if (aspect > 1.6 && aspect < 1.9) {



            cellAnim.anchor.set(isLeftTex ? 0.4688 : 0.5308, 0.2098);



            cellAnim.x = (col + 0.5) * PARAMS.cellSize;



            cellAnim.y = (row + 0.5) * PARAMS.cellSize;



            



            // 按照原版比例缩放：原版图?2048，方块占 127



            const spriteW = PARAMS.cellSize * (texW / 127);



            cellAnim.width = spriteW;



            cellAnim.height = spriteW * aspect;



            cellAnim.animationSpeed = 44 / 60; // 匹配原版播放速度 ~0.73s (44?



          } else {



            // 普通的正方形或常规比例特效，居中对齐，缩放?2.5 倍格子大?



            cellAnim.anchor.set(0.5, 0.5);



            cellAnim.x = (col + 0.5) * PARAMS.cellSize;



            cellAnim.y = (row + 0.5) * PARAMS.cellSize;



            



            cellAnim.width = PARAMS.cellSize * 2.5;



            cellAnim.height = cellAnim.width * aspect;



            cellAnim.animationSpeed = 1.0;



          }



          cellAnim.loop = false;



        } else {



          // 锚点定位到方块中心（实测：右?0.5308,0.2098 左侧 0.4688,0.2098?



          cellAnim.anchor.set(isLeftTex ? 0.4688 : 0.5308, 0.2098);



          cellAnim.x = (col + 0.5) * PARAMS.cellSize;



          cellAnim.y = (row + 0.5) * PARAMS.cellSize;



          // 图片 2048x3660，方?127px。缩放使方块 = cellSize



          const spriteW = PARAMS.cellSize * (2048 / 127);



          const spriteH = spriteW * (3660 / 2048);



          cellAnim.width = spriteW;



          cellAnim.height = spriteH;



          cellAnim.loop = false;



          cellAnim.animationSpeed = 44 / 60; // 44?~0.73s



        }







        const filter = new PIXI.ColorMatrixFilter();



        const cellColor = getShatterColorAtColumn(col);



        const params = colorParams[cellColor] || { hue: 0, saturate: 0 };



        filter.hue(params.hue, false);



        if (params.saturate !== 0) {



          filter.saturate(params.saturate, true);



        }



        cellAnim.filters = [filter];







        worldContainer.addChild(cellAnim);



        cellAnim.play();



        cellAnim.onComplete = () => {



          worldContainer.removeChild(cellAnim);



          cellAnim.destroy();



        };



      }, delay);



    }



  }



}







function changeColorsInPairs() {



  let nextIndex = Math.floor(Math.random() * COLOR_PAIRS.length);



  if (COLOR_PAIRS.length > 1) {



    while (nextIndex === colorPairIndex) {



      nextIndex = Math.floor(Math.random() * COLOR_PAIRS.length);



    }



  }



  colorPairIndex = nextIndex;



  const pair = COLOR_PAIRS[colorPairIndex];







  blocks.forEach(b => {



    if (b.isCollectible || b.isProp) return;



    const newColor = pair[Math.floor(Math.random() * 2)];



    b.color = newColor;



    const texture = PIXI.Assets.get(`${newColor}-${b.length}`);



    if (texture) {



      b.sprite.texture = texture;



    }



  });







  const btnColorMode = document.getElementById('btn-color-mode');



  if (btnColorMode) {



    btnColorMode.innerHTML = `<span class="icon">🎨</span>变色: ${getColorLabel(pair[0])}/${getColorLabel(pair[1])}`;



  }



}







function changeSingleColor() {



  let nextIndex = Math.floor(Math.random() * SINGLE_COLORS.length);



  if (SINGLE_COLORS.length > 1) {



    while (nextIndex === singleColorIndex) {



      nextIndex = Math.floor(Math.random() * SINGLE_COLORS.length);



    }



  }



  singleColorIndex = nextIndex;



  const color = SINGLE_COLORS[singleColorIndex];







  blocks.forEach(b => {



    if (b.isCollectible || b.isProp) return;



    b.color = color;



    const texture = PIXI.Assets.get(`${color}-${b.length}`);



    if (texture) {



      b.sprite.texture = texture;



    }



  });







  const btnSingleColorMode = document.getElementById('btn-single-color-mode');



  if (btnSingleColorMode) {



    btnSingleColorMode.innerHTML = `<span class="icon">🎨</span>单色: ${getColorLabel(color)}`;



  }



}















function checkEliminations() {



  const occ = getGridOccupancy();



  const fullRows: number[] = [];







  if (activeSimulatingStepIndex !== null && !isRepairingScript) {



    const step = scriptSteps[activeSimulatingStepIndex];



    const allowed = getPlaybackAllowedRows(step);



    for (let r = 0; r < PARAMS.totalRows; r++) {



      let isFull = true;



      for (let c = 0; c < PARAMS.gridCols; c++) { if (occ[r][c] === 0) { isFull = false; break; } }



      if (isFull && allowed.includes(r)) fullRows.push(r);



    }



  } else {



    // Only check rows visible in the viewport



    const minVisibleY = -worldContainer.y;



    const minRow = Math.max(0, Math.floor(minVisibleY / PARAMS.cellSize));



    const maxRow = getVisibleBottomRowForWorldY(worldContainer.y);







    for (let r = minRow; r <= maxRow; r++) {



      let isFull = true;



      for (let c = 0; c < PARAMS.gridCols; c++) { if (occ[r][c] === 0) { isFull = false; break; } }



      if (isFull) fullRows.push(r);



    }



  }







  if (fullRows.length > 0) {
    // TRACK ELIMINATIONS FOR PLAYABLE
    playableCombos++;
    playableRows += fullRows.length;
    if (typeof (window as any).checkPlayableLimits === 'function') (window as any).checkPlayableLimits();

    // PRE-CALCULATE prop columns before they take damage (to prevent particle shatter on props)
    const initialPropColsByRow = new Map<number, Set<number>>();
    fullRows.forEach(r => initialPropColsByRow.set(r, new Set<number>()));
    blocks.forEach(b => {
      if (b.isProp && initialPropColsByRow.has(b.row)) {
        const skipSet = initialPropColsByRow.get(b.row)!;
        for (let c = 0; c < b.length; c++) skipSet.add(b.col + c);
      }
    });

    // Props take one hit when their row or an adjacent row clears.
    let anyPropDamaged = false;
    blocks.forEach(b => {

      if (!b.isProp) return;

      const damage = damagePropForClearedRows(b, fullRows);

      if (damage.triggered) {
        anyPropDamaged = true;
        const dir = b.propDir || 'left';
        const oldCol = b.col;
        const oldLen = b.length;
        b.col = damage.col;
        b.length = damage.length;

        // Calculate hit distance: 0 for direct hit, 1 for adjacent hit
        const hitDistance = fullRows.includes(b.row) ? 0 : 1;
        // Direct hits wait 100ms. Adjacent hits wait an extra 100ms.
        const animationDelay = 100 + hitDistance * 100;

        setTimeout(() => {
          if ((sounds as any).propElim) playSound((sounds as any).propElim);
          
          animatePropShrink(b.sprite, dir, oldCol, oldLen, b.col, b.length, () => {
            if (b.length <= 0 && b.sprite && b.sprite.parent) {
              blocksContainer.removeChild(b.sprite);
            }
          });
        }, animationDelay);
      }

    });

    // Remove dead props (length <= 0)

    blocks = blocks.filter(b => !b.isProp || b.length > 0);







    if (isRecordingSteps && activeRecordingStepIndex !== null) {



      appendStepEliminationWave(activeRecordingStepIndex, fullRows);



    }



    if (activeSimulatingStepIndex !== null && !isRepairingScript && shouldAdvancePlaybackWave(scriptSteps[activeSimulatingStepIndex])) {



      activeEliminationWaveIndex++;



    }







    isAnimating = true;



    hasAnyEliminationThisStep = true;



    comboCount += 1;

    if (isRisingAdvanceActive()) {
      risingEliminationWavesThisMove += 1;
      pendingRisingRows = getRisingRowsForCompletedMove(risingEliminationWavesThisMove);
    }



    if (isColorChangingMode) {



      changeColorsInPairs();



    }



    if (isSingleColorMode) {



      changeSingleColor();



    }



    if (isMaterialChangingMode) {



      changeMaterialsInOrder();



    }



    playSound(sounds.combos[Math.min(9, comboCount - 1)]);



    



    // 播放人声消除赞美音效



    const isMuteVocals = (document.getElementById('input-mutevocals') as HTMLInputElement)?.checked || false;



    if (!isMuteVocals) {



      if (comboCount === 1) playSound(sounds.vocals.good);



      else if (comboCount === 2) playSound(sounds.vocals.great);



      else if (comboCount === 3) playSound(sounds.vocals.amazing);



      else if (comboCount === 4) playSound(sounds.vocals.excellent);



      else if (comboCount >= 5) playSound(sounds.vocals.unbelievable);



    }



    const scoreEl = document.getElementById('score-val');



    if (scoreEl) {



      const current = parseInt(scoreEl.innerText.replace(/,/g, ''));



      const target = current + fullRows.length * 888;



      const counter = { val: current };



      gsap.to(counter, {



        val: target,



        duration: 0.5,



        ease: 'power2.out',



        onUpdate: () => {



          scoreEl.innerText = Math.round(counter.val).toLocaleString();



        }



      });



    }







    const blocksToRemove = blocks.filter(b => !b.isProp && fullRows.includes(b.row));



    if (blocksToRemove.some(b => b.isCollectible)) {



      playSound(sounds.obtain);



    }







    const elimDelayInput = document.getElementById('input-script-delay-elim') as HTMLInputElement;



    const customElimDelay = elimDelayInput ? (parseFloat(elimDelayInput.value) || 0.1) : 0.1;







    const tl = gsap.timeline({



      onComplete: () => {


        blocksToRemove.forEach(b => {
          if (isCollectMode && b.isCollectible) {
            const coin = new PIXI.Sprite(activeCollectibleTexture || PIXI.Texture.WHITE);
            coin.width = b.sprite.width;
            coin.height = b.sprite.height;
            coin.x = b.sprite.x;
            coin.y = b.sprite.y;
            coin.zIndex = 9999;
            worldContainer.addChild(coin);
            
            const targetX = 50;
            const targetY = -worldContainer.y + 150;
            
            gsap.to(coin, {
              x: targetX,
              y: targetY,
              duration: 0.6,
              ease: 'power2.inOut',
              onComplete: () => {
                 worldContainer.removeChild(coin);
                 const targetElement = document.getElementById('jewel-collect-target-val');
                 const nextTarget = getNextCollectionMissionTarget(
                   targetElement ? Number.parseInt(targetElement.innerText, 10) : undefined,
                 );

                 // The playable editor no longer exposes the legacy jewel target UI.
                 // Do not treat a missing target as zero and immediately complete a mission.
                 if (nextTarget !== null && targetElement) {
                   targetElement.innerText = String(nextTarget);
                   if (nextTarget === 0) {
                     const go = document.getElementById('game-over-text');
                     if (go) {
                       go.style.display = 'block';
                       go.innerText = 'MISSION COMPLETE!';
                       go.style.color = '#ffcc00';
                     }
                   }
                 }
                 
                 // TRACK COLLECTS FOR PLAYABLE
                 playableCollects++;
                 if (typeof (window as any).checkPlayableLimits === 'function') (window as any).checkPlayableLimits();
              }
            });
          }
          blocksContainer.removeChild(b.sprite);
        });


        blocks = blocks.filter(b => b.isProp || !fullRows.includes(b.row));







        if (isRisingAdvanceActive()) {










          // Clear dragged block state so secondary drops do not trigger color shifts



          draggedBlockId = null;







          // Run gravity (falling) first; rising will happen after all combos finish



          setTimeout(() => {
            isAnimating = false;
            applyGravity(true);
          }, Math.max(customElimDelay * 1000, typeof anyPropDamaged !== "undefined" && anyPropDamaged ? 400 : 0));



        } else {



          // Shift rowColors on eliminations



          fullRows.sort((a, b) => a - b).forEach(r => {



            for (let y = r; y > 0; y--) {



              rowColors[y] = rowColors[y - 1];



            }



            rowColors[0] = getRainbowFixedColor(0);



          });







          // Clear dragged block state so secondary drops do not trigger color shifts



          draggedBlockId = null;







          setTimeout(() => {
            isAnimating = false;
            applyGravity(true);
          }, Math.max(customElimDelay * 1000, typeof anyPropDamaged !== "undefined" && anyPropDamaged ? 400 : 0));



        }



      }



    });







    lastShatterCellColors = [];



    fullRows.forEach(r => {



      // 确定当前行爆炸特效颜色：优先使用玩家刚刚滑动掉落那个块儿的颜色（如果它在当前行的话）



      const rowBlocks = blocksToRemove.filter(b => b.row === r);



      let explosionColor = 'pink';



      const draggedBlockInRow = rowBlocks.find(b => b.id === draggedBlockId);



      if (draggedBlockInRow) {



        explosionColor = draggedBlockInRow.color;



      } else {



        const fallingBlock = rowBlocks.find(b => blocksThatFell.has(b.id));



        explosionColor = fallingBlock ? fallingBlock.color : (rowBlocks[0] ? rowBlocks[0].color : 'pink');



      }







      tl.call(() => {



        const propSkipCols = initialPropColsByRow.get(r) || new Set<number>();
        if (PARAMS.effectType !== 'gem-shatter') {
          playRowShatterEffect(r, explosionColor, rowBlocks, propSkipCols);
        }



      }, [], 0);







      const rowBlocksAnim = blocksToRemove.filter(b => b.row === r);



      const mode = PARAMS.shatterMode || 1;



      const centerCol = PARAMS.gridCols / 2;



      const totalStagger = (mode === 2) ? 0 : 0.5;



      const maxDist = (mode === 3 || mode === 4) ? (PARAMS.gridCols - 1) : Math.ceil(PARAMS.gridCols / 2);



      const staggerPerCell = maxDist > 0 ? totalStagger / maxDist : 0;







      rowBlocksAnim.forEach((b) => {



        const refCol = b.col + b.length / 2;



        let delay: number;







        if (mode === 3) {



          delay = b.col * staggerPerCell;



        } else if (mode === 4) {



          delay = (PARAMS.gridCols - b.col - b.length) * staggerPerCell;



        } else {



          const isLeft = refCol < centerCol;



          const dist = isLeft ? (centerCol - refCol) : (refCol - centerCol);



          delay = Math.max(0, dist) * staggerPerCell;



        }







        if (b.isCollectible) {



          tl.call(() => {



            playCollectibleFlyAnimation(b);



          }, [], delay);



        }



        tl.to(b.sprite.scale, { y: 0, duration: 0.1, ease: 'power2.in' }, delay);
        tl.to(b.sprite, { alpha: 0, duration: 0.1 }, delay);

        if (PARAMS.effectType === 'gem-shatter') {
          tl.call(() => {
            const texArray = gemShatterTextures[b.color as string];
            if (texArray && texArray.length > 0 && texArray[0]) {
              const cellSz = PARAMS.cellSize || 50;
              const validTexArray = texArray.filter((t: any) => t);
              
              for (let i = 0; i < b.length; i++) {
                const anim = new PIXI.AnimatedSprite(validTexArray);
                anim.loop = false;
                anim.animationSpeed = 0.5; // adjust if too fast/slow
                
                // The visual center of the burst in these specific sequence frames is at roughly 22.6% from the top (Y=122 / 538)
                // So we anchor the Y axis at 0.226 to align the explosion origin exactly with the block center.
                anim.anchor.set(0.5, 0.226);
                
                // Position it perfectly on each cell of the block sprite
                anim.x = b.sprite.x + (i * cellSz) + (cellSz / 2);
                anim.y = b.sprite.y + (cellSz / 2);
                
                // Scale it to be large enough for the cell while preserving aspect ratio
                // User requested it to be bigger.
                const targetSize = cellSz * 5.5; 
                anim.width = targetSize;
                anim.scale.y = anim.scale.x;
                
                // Make the effect look purer and brighter using ADD blend mode
                anim.blendMode = 'add';
                
                // Add a very slight rotation or scale variation to make it look organic
                anim.rotation = (Math.random() - 0.5) * 0.2;
                
                anim.onComplete = () => {
                  if (anim.parent) anim.parent.removeChild(anim);
                  anim.destroy();
                };
                blocksContainer.addChild(anim);
                anim.play();
              }
            }
          }, [], delay);
        }





      });







      if (mode === 2) {



        tl.to({}, { duration: 0.5 }, 0);



      }



    });







  } else {



    // No full rows to eliminate ?combo chain is over



    // Every completed movement advances once. Each elimination wave contributes
    // one row, capped at three rows for the entire move.
    if (isRisingAdvanceActive() && draggedBlockId !== null) {
      pendingRisingRows = getRisingRowsForCompletedMove(risingEliminationWavesThisMove);
    }







    if (pendingRisingRows > 0) {



      // All combos done, now rise one row at a time



      riseOneRow();



    } else {



      if (maybeRefillFallingTopArea()) {



        blocksThatFell.clear();



        draggedBlockId = null;



        activeRecordingStepIndex = null;



        return;



      }



      if (maybeSpawnFallingTopPage()) {



        isAnimating = false;



        blocksThatFell.clear();



        draggedBlockId = null;



        activeRecordingStepIndex = null;



        return;



      }



      isAnimating = false;



      blocksThatFell.clear();



      draggedBlockId = null;



      activeRecordingStepIndex = null;



      if (!hasAnyEliminationThisStep) {



        comboCount = 0;



      }



      



      // Fixed Board Mode Victory Check



      if (isFixedAdvanceActive() && blocks.length === 0) {



        triggerVictory();



      }



    }



  }



}







// ---- Generators ----



function generateRandomLayout() {



  console.log('generateRandomLayout started. isNoGravityMode:', isNoGravityMode, 'isCustomTwoColorMode:', isCustomTwoColorMode);



  clearAllBlocks();



  playSound(sounds.spawn);



  if (isColorChangingMode) { /* keep current colorPairIndex */ }



  if (isSingleColorMode) singleColorIndex = 0;



  if (isCollectMode) {



    collectedCount = 0;



    updateHeaderUI();



  }



  const currentPair = isColorChangingMode ? COLOR_PAIRS[colorPairIndex] : null;



  const currentSingleColor = isSingleColorMode ? SINGLE_COLORS[0] : null;



  // Keep a larger top buffer in scrolling mode so a fresh random board does



  // not immediately enter the danger line after the game starts.



  const startRow = getActiveBoardAdvanceMode() === 'scroll'



    ? Math.max(8, Math.ceil(PARAMS.viewportRows * 0.45))



    : 5;



  const endRow = PARAMS.totalRows - 1;



  console.log('startRow:', startRow, 'endRow:', endRow, 'gridCols:', PARAMS.gridCols);



  let spawnCount = 0;



  for (let r = endRow; r >= startRow; r--) {



    let c = 0;



    while (c < PARAMS.gridCols) {



      // Skip hole cells (outside board shape)



      if (holeMask[r] && holeMask[r][c]) { c++; continue; }



      const remaining = PARAMS.gridCols - c;



      if (Math.random() < 0.2) { c++; continue; }



      // Don't generate blocks that extend into holes'



      let maxLen = 0;



      for (let i = c; i < PARAMS.gridCols && (!holeMask[r] || !holeMask[r][i]); i++) maxLen++;



      const len = weightedRandomLength(Math.min(4, Math.min(maxLen, remaining)));



      if (len > 0) {



        let color: string;



        if (isCustomTwoColorMode) {



          color = selectedTwoColors[Math.floor(Math.random() * 2)];



        } else if (isColorChangingMode && currentPair) {



          color = currentPair[Math.floor(Math.random() * 2)];



        } else if (isSingleColorMode && currentSingleColor) {



          color = currentSingleColor;



        } else if (isRainbowFixedMode) {



          color = rowColors[r];



        } else {



          color = getRandomColor();



        }



        const isCollectibleBlock = isCollectMode && len === 1 && Math.random() < 0.3;



        const b = spawnBlock(c, r, len, color, undefined, undefined, isCollectibleBlock);



        if (b) {



          spawnCount++;



        } else {



          console.warn(`spawnBlock returned null at c=${c}, r=${r}, len=${len}, color=${color}`);



        }



        c += len;



      } else c++;



    }



  }



  console.log('generateRandomLayout finished. Spawned count:', spawnCount, 'Total blocks now:', blocks.length);



  preventFullRows();



}







function pickColorForCurrentMode(row: number): string {



  if (isCustomTwoColorMode) {



    return selectedTwoColors[Math.floor(Math.random() * 2)];



  }



  if (isColorChangingMode) {



    const pair = COLOR_PAIRS[colorPairIndex % COLOR_PAIRS.length];



    return pair[Math.floor(Math.random() * 2)];



  }



  if (isSingleColorMode) {



    return SINGLE_COLORS[singleColorIndex % SINGLE_COLORS.length];



  }



  if (isRainbowFixedMode && row >= 0 && row < rowColors.length) {



    return rowColors[row];



  }



  return getRandomColor();



}







function getVisibleOccupiedRows(): Set<number> {



  const minVisibleRow = Math.max(0, Math.floor(-worldContainer.y / PARAMS.cellSize));



  const maxVisibleRow = Math.min(



    PARAMS.totalRows - 1,



    Math.floor((-worldContainer.y + getViewportGameHeight() - 1) / PARAMS.cellSize)



  );



  const rows = new Set<number>();



  blocks.forEach(b => {



    if (b.row >= minVisibleRow && b.row <= maxVisibleRow) {



      rows.add(b.row);



    }



  });



  return rows;



}







function getVisibleRowRange(): { minRow: number; maxRow: number } {



  const minRow = Math.max(0, Math.floor(-worldContainer.y / PARAMS.cellSize));



  const maxRow = Math.min(



    PARAMS.totalRows - 1,



    Math.floor((-worldContainer.y + getViewportGameHeight() - 1) / PARAMS.cellSize)



  );



  return { minRow, maxRow };



}







function spawnFallingSupplyRow(row: number, templateRowOverride?: number) {



  const templateRow = (((templateRowOverride ?? row) % PARAMS.totalRows) + PARAMS.totalRows) % PARAMS.totalRows;



  const occupiedColumns = new Set<number>();



  blocks.forEach(block => {



    if (block.row !== row) return;



    for (let column = block.col; column < block.col + block.length; column++) {



      occupiedColumns.add(column);



    }



  });



  const reservedGapCol = randomInt(0, PARAMS.gridCols - 1);



  let c = 0;



  while (c < PARAMS.gridCols) {



    if (



      (holeMask[templateRow] && holeMask[templateRow][c])



      || occupiedColumns.has(c)



      || c === reservedGapCol



    ) {



      c++;



      continue;



    }







    let maxLen = 0;



    for (let i = c; i < PARAMS.gridCols; i++) {



      if (



        (holeMask[templateRow] && holeMask[templateRow][i])



        || occupiedColumns.has(i)



        || i === reservedGapCol



      ) break;



      maxLen++;



    }







    const len = weightedRandomLength(Math.min(4, maxLen));



    if (len <= 0) {



      c++;



      continue;



    }







    const color = pickColorForCurrentMode(templateRow);



    const isCollectibleBlock = isCollectMode && len === 1 && Math.random() < 0.3;



    spawnBlock(c, row, len, color, undefined, undefined, isCollectibleBlock);



    c += len;



  }



}







function maybeRefillFallingTopArea(): boolean {



  if (!isFallingMode || isPlayingScript || currentMode !== 'play' || isSpawningFallingPage) return false;



  const { minRow, maxRow } = getVisibleRowRange();



  const occupiedRows = blocks



    .filter(b => b.row >= minRow && b.row <= maxRow)



    .map(b => b.row);







  if (occupiedRows.length === 0) {



    spawnFallingTopPage();



    return true;



  }







  const topOccupiedRow = Math.min(...occupiedRows);



  const blankRowsAtTop = topOccupiedRow - minRow;



  const supplyRows = getFallingTopSupplyRows(blankRowsAtTop, minRow);



  if (supplyRows.length === 0) return false;







  let spawnedSupplyRows = 0;



  for (const r of supplyRows) {



    if (blocks.some(b => b.row === r)) continue;



    spawnFallingSupplyRow(r);



    spawnedSupplyRows++;



  }







  if (spawnedSupplyRows > 0) {



    isAnimating = false;



    applyGravity(true);



    return true;



  }







  return false;



}







function spawnFallingTopPage() {



  if (isSpawningFallingPage) return;



  isSpawningFallingPage = true;







  const rowsToGenerate = Math.max(3, PARAMS.totalRows);



  const startRow = -rowsToGenerate;



  const endRow = -1;







  for (let r = startRow; r <= endRow; r++) {



    const templateRow = ((r - startRow) % PARAMS.totalRows);



    let c = 0;



    while (c < PARAMS.gridCols) {



      if (holeMask[templateRow] && holeMask[templateRow][c]) {



        c++;



        continue;



      }







      let maxLen = 0;



      for (let i = c; i < PARAMS.gridCols; i++) {



        if (holeMask[templateRow] && holeMask[templateRow][i]) break;



        maxLen++;



      }



      const len = weightedRandomLength(Math.min(4, maxLen));



      if (len <= 0) {



        c++;



        continue;



      }







      const color = pickColorForCurrentMode(Math.max(0, templateRow));



      const isCollectibleBlock = isCollectMode && len === 1 && Math.random() < 0.3;



      spawnBlock(c, r, len, color, undefined, undefined, isCollectibleBlock);



      c += len;



    }



  }







  settleFallingTopPageWithoutEliminations();



  isSpawningFallingPage = false;



}







function settleFallingTopPageWithoutEliminations() {



  const minTargetRow = 0;



  const maxTargetRow = PARAMS.totalRows - 1;



  const targetRows = Math.max(1, maxTargetRow - minTargetRow + 1);



  const pageBlocks = blocks.filter(b => b.row < minTargetRow);



  if (pageBlocks.length > 0) {



    const maxSourceRow = Math.max(...pageBlocks.map(b => b.row));



    const offset = maxTargetRow - maxSourceRow;



    pageBlocks.forEach(b => {



      b.row += offset;



      if (b.row < minTargetRow) {



        b.row = minTargetRow + ((b.row - minTargetRow + targetRows * 10) % targetRows);



      }



      if (b.row > maxTargetRow) b.row = maxTargetRow;



      b.sprite.y = b.row * PARAMS.cellSize;



    });



  }







  let changed = true;



  let safetyCounter = 0;



  while (changed && safetyCounter < 100) {



    changed = false;



    safetyCounter++;







    blocks.sort((a, b) => b.row - a.row);



    blocks.forEach(b => {



      if (b.row < minTargetRow || b.row > maxTargetRow) return;



      let targetRow = b.row;



      while (targetRow < maxTargetRow) {



        let canDrop = true;



        const nextRow = targetRow + 1;







        if (nextRow >= 0 && holeMask && holeMask[nextRow]) {



          for (let c = b.col; c < b.col + b.length; c++) {



            if (holeMask[nextRow][c]) { canDrop = false; break; }



          }



        }







        if (canDrop) {



          for (const other of blocks) {



            if (other.id === b.id) continue;



            if (other.row === nextRow) {



              if (b.col < other.col + other.length && b.col + b.length > other.col) { canDrop = false; break; }



            }



          }



        }







        if (canDrop) targetRow++;



        else break;



      }







      if (targetRow !== b.row) {



        b.row = targetRow;



        b.sprite.y = targetRow * PARAMS.cellSize;



        changed = true;



      }



    });







    const occ = getGridOccupancy();



    for (let r = minTargetRow; r <= maxTargetRow; r++) {



      let isFull = true;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (occ[r][c] === 0) { isFull = false; break; }



      }



      if (isFull) {



        const blocksInRow = blocks.filter(b => b.row === r);



        if (blocksInRow.length > 0) {



          const toRemove = blocksInRow[randomInt(0, blocksInRow.length - 1)];



          blocksContainer.removeChild(toRemove.sprite);



          toRemove.sprite.destroy();



          blocks = blocks.filter(b => b.id !== toRemove.id);



          changed = true;



        }



      }



    }



  }







  for (let r = minTargetRow; r <= maxTargetRow; r++) {



    const hasBlockInRow = blocks.some(b => b.row === r);



    if (hasBlockInRow) continue;







    const availableCols: number[] = [];



    for (let c = 0; c < PARAMS.gridCols; c++) {



      if (holeMask[r] && holeMask[r][c]) continue;



      const occupied = blocks.some(b => b.row === r && c >= b.col && c < b.col + b.length);



      if (!occupied) availableCols.push(c);



    }







    if (availableCols.length > 0) {



      const col = availableCols[randomInt(0, availableCols.length - 1)];



      const color = pickColorForCurrentMode(r);



      const isCollectibleBlock = isCollectMode && Math.random() < 0.3;



      spawnBlock(col, r, 1, color, undefined, undefined, isCollectibleBlock);



    }



  }



}







function maybeSpawnFallingTopPage(): boolean {



  if (!isFallingMode || isPlayingScript || currentMode !== 'play') return false;



  const hasHiddenTopBlocks = blocks.some(b => b.row < 0);



  if (hasHiddenTopBlocks) return false;







  const visibleRows = getVisibleOccupiedRows();



  if (visibleRows.size > 1) return false;







  spawnFallingTopPage();



  return true;



}







function isBlockSupported(c: number, len: number, row: number): boolean {



  if (row === PARAMS.totalRows - 1) return true; // bottom row always supported



  for (let i = c; i < c + len; i++) {



    // If the cell below is a board hole (outside the board shape), it acts as solid ground



    if (holeMask && holeMask[row + 1] && holeMask[row + 1][i]) return true;







    // If the cell below is a layout hole (empty cell painted by user), it cannot support



    if (layoutDrawMask && layoutDrawMask[row + 1] && layoutDrawMask[row + 1][i]) continue;







    // Otherwise, check if there is an already spawned block below



    const hasBlockBelow = blocks.some(b => b.row === row + 1 && i >= b.col && i < b.col + b.length);



    if (hasBlockBelow) return true;



  }



  return false;



}







function getValidPartitions(remainingLen: number, c: number, r: number): number[][] {



  if (remainingLen === 0) return [[]];



  const partitions: number[][] = [];



  const maxLen = Math.min(4, remainingLen);



  for (let len = 1; len <= maxLen; len++) {



    if (isBlockSupported(c, len, r)) {



      const subPartitions = getValidPartitions(remainingLen - len, c + len, r);



      for (const sub of subPartitions) {



        partitions.push([len, ...sub]);



      }



    }



  }



  return partitions;



}







function pickPartition(partitions: number[][]): number[] {



  if (partitions.length === 0) return [];



  let totalWeight = 0;



  const weights = partitions.map(p => {



    let sum = 0;



    for (const len of p) sum += PROBS[len as keyof typeof PROBS];



    return sum / p.length;



  });



  



  for (const w of weights) totalWeight += w;



  let rand = Math.random() * totalWeight;



  for (let i = 0; i < partitions.length; i++) {



    rand -= weights[i];



    if (rand <= 0) return partitions[i];



  }



  return partitions[partitions.length - 1];



}







function generateFromHoles() {



  clearAllBlocks();



  playSound(sounds.spawn);



  if (isColorChangingMode) { /* keep current colorPairIndex */ }



  if (isSingleColorMode) singleColorIndex = 0;



  for (let r = PARAMS.totalRows - 1; r >= 0; r--) {



    let c = 0;



    while (c < PARAMS.gridCols) {



      if ((holeMask[r] && holeMask[r][c]) || (layoutDrawMask[r] && layoutDrawMask[r][c])) { c++; continue; }







      // Find end of this solid segment



      let endCol = c;



      while (endCol + 1 < PARAMS.gridCols && (!holeMask[r] || !holeMask[r][endCol + 1]) && (!layoutDrawMask[r] || !layoutDrawMask[r][endCol + 1])) endCol++;







      const remaining = endCol - c + 1;



      const validPartitions = getValidPartitions(remaining, c, r);



      



      let chosenPartition: number[];



      if (validPartitions.length > 0) {



        chosenPartition = pickPartition(validPartitions);



      } else {



        // Fallback for floating/unsupported shapes



        chosenPartition = [];



        let rem = remaining;



        while (rem > 0) {



          let l = weightedRandomLength(Math.min(4, rem));



          if (l <= 0) l = 1; // Fallback to 1 if weights resolve to 0 to prevent infinite loop



          chosenPartition.push(l);



          rem -= l;



        }



      }







      for (const len of chosenPartition) {



        let color: string;



        if (isCustomTwoColorMode) {



          color = selectedTwoColors[Math.floor(Math.random() * 2)];



        } else if (isColorChangingMode) {



          const pair = COLOR_PAIRS[colorPairIndex % COLOR_PAIRS.length];



          color = pair[Math.floor(Math.random() * 2)];



        } else if (isSingleColorMode) {



          color = SINGLE_COLORS[singleColorIndex % SINGLE_COLORS.length];



        } else if (isRainbowFixedMode) {



          color = rowColors[r];



        } else {



          color = getRandomColor();



        }



        const isCollectibleBlock = isCollectMode && len === 1 && Math.random() < 0.3;



        spawnBlock(c, r, len, color, undefined, undefined, isCollectibleBlock);



        c += len;



      }



    }



  }



}







function preventFullRows() {



  const occ = getGridOccupancy();



  for (let r = 0; r < PARAMS.totalRows; r++) {



    let isFull = true;



    for (let c = 0; c < PARAMS.gridCols; c++) { if (occ[r][c] === 0) { isFull = false; break; } }



    if (isFull) {



      const blocksInRow = blocks.filter(b => b.row === r);



      if (blocksInRow.length > 0) {



        const toRemove = blocksInRow[randomInt(0, blocksInRow.length - 1)];



        blocksContainer.removeChild(toRemove.sprite);



        toRemove.sprite.destroy();



        blocks = blocks.filter(b => b.id !== toRemove.id);



      }



    }



  }



}







function settleLayoutWithoutEliminations() {



  let changed = true;



  let safetyCounter = 0;



  while (changed && safetyCounter < 100) {



    changed = false;



    safetyCounter++;







    // 1. Let blocks fall down under gravity (instantly)



    blocks.sort((a, b) => b.row - a.row); // Bottom blocks first



    blocks.forEach(b => {



      let targetRow = b.row;



      if (isNoGravityMode && b.noGravity) return;



      while (targetRow < PARAMS.totalRows - 1) {



        let canDrop = true;



        if (holeMask && holeMask[targetRow + 1]) {



          for (let c = b.col; c < b.col + b.length; c++) {



            if (holeMask[targetRow + 1][c]) { canDrop = false; break; }



          }



        }



        if (canDrop) {



          for (const other of blocks) {



            if (other.id === b.id) continue;



            if (other.row === targetRow + 1) {



              if (b.col < other.col + other.length && b.col + b.length > other.col) { canDrop = false; break; }



            }



          }



        }



        if (canDrop) targetRow++;



        else break;



      }



      if (targetRow !== b.row) {



        b.row = targetRow;



        b.sprite.y = targetRow * PARAMS.cellSize;



        if (isRainbowFixedMode) {



          const newColor = rowColors[targetRow];



          b.color = newColor;



          const texture = PIXI.Assets.get(`${newColor}-${b.length}`);



          if (texture) b.sprite.texture = texture;



        }



        changed = true;



      }



    });







    // 2. Check for full rows. If there are any, break them instead of eliminating them!



    const occ = getGridOccupancy();



    for (let r = 0; r < PARAMS.totalRows; r++) {



      let isFull = true;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (occ[r][c] === 0) { isFull = false; break; }



      }



      if (isFull) {



        const blocksInRow = blocks.filter(b => b.row === r);



        if (blocksInRow.length > 0) {



          const toRemove = blocksInRow[randomInt(0, blocksInRow.length - 1)];



          blocksContainer.removeChild(toRemove.sprite);



          toRemove.sprite.destroy();



          blocks = blocks.filter(b => b.id !== toRemove.id);



          changed = true;



        }



      }



    }



  }



}







// ---- Interactions ----



function setupInteraction() {



  app.stage.eventMode = 'static';



  app.stage.hitArea = new PIXI.Rectangle(0, 0, 10000, 10000);







  let isPainting = false;



  let isErasing = false;







  const handlePointerAction = (e: PIXI.FederatedPointerEvent, isDownEvent: boolean) => {



    if (currentMode !== 'draw' && currentMode !== 'board-edit') return;



    const pos = e.getLocalPosition(worldContainer);



    const col = Math.floor(pos.x / PARAMS.cellSize);



    const row = Math.floor(pos.y / PARAMS.cellSize);







    if (col >= 0 && col < PARAMS.gridCols && row >= 0 && row < PARAMS.totalRows) {



      if (currentMode === 'board-edit') {



        // Board-edit: painting ADDS valid cells (clears holes)



        if (isDownEvent) {



          isErasing = !holeMask[row][col]; // If already valid, we're erasing (making hole)'



        }



        const newVal = isErasing; // true = hole, false = valid



        if (holeMask[row][col] !== newVal) {



          holeMask[row][col] = newVal;



          drawHoles();



        }



      } else {



        // Draw mode: painting ADDS temporary layout holes



        // Only allow drawing on valid board cells (where holeMask is false)



        if (holeMask && holeMask[row] && holeMask[row][col]) return;







        if (isDownEvent) {



          isErasing = layoutDrawMask[row][col];



        }



        if (layoutDrawMask[row][col] !== !isErasing) {



          layoutDrawMask[row][col] = !isErasing;



          drawHoles();



        }



      }



    }



  };







  app.stage.on('pointerdown', (e) => {



    if (currentMode === 'draw' || currentMode === 'board-edit') { isPainting = true; handlePointerAction(e, true); }



    else if (currentMode === 'manual') {



      const pos = e.getLocalPosition(worldContainer);



      const col = Math.floor(pos.x / PARAMS.cellSize);



      const row = Math.floor(pos.y / PARAMS.cellSize);



      if (col >= 0 && col < PARAMS.gridCols && row >= 0 && row < PARAMS.totalRows) {



        const existing = blocks.find(b => b.row === row && col >= b.col && col < b.col + b.length);



        if (existing) {



          playSound(sounds.fall);



          blocksContainer.removeChild(existing.sprite);



          existing.sprite.destroy();



          blocks = blocks.filter(b => b.id !== existing.id);



          updateManualPreview(col, row);



        } else if (manualSelectedBlock) {



          const { length, color } = manualSelectedBlock;



          if (canPlaceBlock(col, row, length)) {



            playSound(sounds.spawn);



            const isColl = color === 'collectible';

            const isPropBlock = color === 'prop-row-bomb' || color === 'prop-peppermint';

            let propTypeVal: 'row-bomb' | 'peppermint' | undefined = undefined;

            if (color === 'prop-peppermint') propTypeVal = 'peppermint';

            else if (color === 'prop-row-bomb') propTypeVal = 'row-bomb';



            let spawnColor = color;



            if (isColl) {

              const activeIdStr = String(activeCollectibleId);

              if (activeIdStr === 'star' || activeIdStr === 'coin') spawnColor = 'yellow';

              else if (activeIdStr === 'gem') spawnColor = 'blue';

              else if (activeIdStr === 'heart') spawnColor = 'pink';

              else spawnColor = 'pink';

            } else if (isPropBlock) {

              spawnColor = 'red'; // Props use a default color for gravity/data purposes

            }



            spawnBlock(col, row, length, spawnColor, undefined, undefined, isColl, isPropBlock, propTypeVal, manualSelectedBlock.propDir || 'left');



            updateManualPreview(col, row);



          }



        }



      }



    }



  });



  app.stage.on('pointermove', (e) => {



    if (isPainting) handlePointerAction(e, false);



    if (currentMode === 'manual') {



      const pos = e.getLocalPosition(worldContainer);



      const col = Math.floor(pos.x / PARAMS.cellSize);



      const row = Math.floor(pos.y / PARAMS.cellSize);



      if (col >= 0 && col < PARAMS.gridCols && row >= 0 && row < PARAMS.totalRows) {



        updateManualPreview(col, row);



      } else {



        if (manualPreviewSprite) manualPreviewSprite.visible = false;



      }



    }



  });



  app.stage.on('pointerup', () => isPainting = false);



  app.stage.on('pointerupoutside', () => isPainting = false);







  app.canvas.addEventListener('wheel', (e) => {



    if ((window as any).PLAYABLE_CONFIG) {
      e.preventDefault();
      return;
    }



    if (isGameStarted && boardAdvanceMode !== 'fixed') return;



    e.preventDefault();



    



    virtualScrollY -= e.deltaY * 0.5;



    const minY = getBottomWorldY();



    virtualScrollY = Math.max(minY, Math.min(0, virtualScrollY));







    setWorldY(virtualScrollY);



  }, { passive: false });







  app.canvas.addEventListener('contextmenu', e => e.preventDefault());



}







function syncShatterModeUI() {



  PARAMS.shatterMode = PARAMS.shatterMode || 1;



  const mode = PARAMS.shatterMode;



  const shatterBtns = document.querySelectorAll('.shatter-mode-btn');



  shatterBtns.forEach(btn => {



    const btnMode = parseInt(btn.getAttribute('data-mode') || '1');



    if (btnMode === mode) {



      btn.classList.add('active');



      (btn as HTMLButtonElement).style.background = '#3b6bdc';



      (btn as HTMLButtonElement).style.color = 'white';



    } else {



      btn.classList.remove('active');



      (btn as HTMLButtonElement).style.background = 'transparent';



      (btn as HTMLButtonElement).style.color = '#aaa';



    }



  });



}







function setupShatterModeButtons() {



  const shatterBtns = document.querySelectorAll('.shatter-mode-btn');



  shatterBtns.forEach(btn => {



    btn.addEventListener('click', () => {



      const mode = parseInt(btn.getAttribute('data-mode') || '1');



      PARAMS.shatterMode = mode;



      syncShatterModeUI();



    });



  });



  syncShatterModeUI();



}







function syncEffectTypeUI() {



  const type = PARAMS.effectType || 'default';



  const effectCards = document.querySelectorAll('.effect-card');



  effectCards.forEach(card => {



    const cardType = card.getAttribute('data-type') || 'default';



    if (cardType === type) {



      card.classList.add('active');



    } else {



      card.classList.remove('active');



    }



  });



}







/** ?PARAMS/PROBS 鐨勫綋鍓嶅€煎悓姝ュ洖鎵€鏈?HTML input 鍏冪?*/



function syncAllInputsFromParams() {



  const setVal = (id: string, val: string | number) => {



    const el = document.getElementById(id) as HTMLInputElement | null;



    if (el) el.value = String(val);



  };



  const setSpan = (id: string, val: string | number) => {



    const el = document.getElementById(id);



    if (el) el.textContent = String(val);



  };



  setVal('input-cols', PARAMS.gridCols);



  setVal('slider-cols', PARAMS.gridCols);



  setSpan('val-cols', PARAMS.gridCols);



  setVal('input-vprows', PARAMS.viewportRows);



  setVal('slider-vprows', PARAMS.viewportRows);



  setSpan('val-vprows', PARAMS.viewportRows);



  setVal('input-rows', PARAMS.totalRows);



  setVal('slider-rows', PARAMS.totalRows);



  setSpan('val-rows', PARAMS.totalRows);



  setVal('input-cellsize', PARAMS.cellSize);



  setVal('slider-cellsize', PARAMS.cellSize);



  setSpan('val-cellsize', PARAMS.cellSize);



  setVal('input-speed', PARAMS.scrollSpeed);



  setVal('slider-speed', PARAMS.scrollSpeed);



  setSpan('val-speed', PARAMS.scrollSpeed);



  setVal('input-script-scroll-speed', PARAMS.scrollSpeed);



  const levelText = document.getElementById('level-val')?.innerText || '284';



  setVal('input-level', levelText);



  setVal('slider-level', levelText);



  setSpan('val-level', levelText);



  const scoreText = document.getElementById('score-val')?.innerText?.replace(/,/g, '') || '854682';



  setVal('input-score', scoreText);



  setVal('slider-score', scoreText);



  setSpan('val-score', scoreText);



  [1, 2, 3, 4].forEach(i => {



    const v = PROBS[i as keyof typeof PROBS];



    setVal(`prob-${i}`, v);



    const span = document.getElementById(`val-${i}`);



    if (span) span.innerText = String(v);



  });



  syncShatterModeUI();



  syncEffectTypeUI();



}







function loadRecordingBackgroundImage(dataUrl: string) {



  recordingBackgroundImageLoaded = false;



  recordingBackgroundImage = null;



  if (!dataUrl) return;







  const img = new Image();



  img.onload = () => {



    recordingBackgroundImageLoaded = true;



  };



  img.onerror = () => {



    recordingBackgroundImageLoaded = false;



    recordingBackgroundImage = null;



  };



  img.src = dataUrl;



  recordingBackgroundImage = img;



}







function getManagedRecordingBackgrounds(): ManagedRecordingBackground[] {



  let customItems: ManagedRecordingBackground[] = [];



  try {



    const raw = localStorage.getItem('recordingBackgroundItems');



    const parsed = raw ? JSON.parse(raw) : [];



    if (Array.isArray(parsed)) {



      customItems = parsed.filter(item =>



        item &&



        typeof item.id === 'string' &&



        typeof item.name === 'string' &&



        typeof item.src === 'string'



      );



    }



  } catch (err) {



    console.warn('Failed to parse recording background items:', err);



  }







  return [



    { id: NO_BACKGROUND_ID, name: '无背景', src: '', builtin: true },



    ...customItems



  ];



}







function saveCustomRecordingBackgrounds(items: ManagedRecordingBackground[]) {



  const customItems = items



    .filter(item => !item.builtin && item.id !== MASTER_BACKGROUND_ID && item.id !== NO_BACKGROUND_ID)



    .map(({ id, name, src }) => ({ id, name, src }));



  localStorage.setItem('recordingBackgroundItems', JSON.stringify(customItems));



}







function selectRecordingBackground(item: ManagedRecordingBackground) {



  recordingBackgroundActiveId = item.id;



  recordingBackgroundDataUrl = item.src;



  recordingBackgroundEnabled = item.id !== NO_BACKGROUND_ID && !!item.src;



  localStorage.setItem('recordingBackgroundActiveId', recordingBackgroundActiveId);



  localStorage.setItem('recordingBackgroundDataUrl', recordingBackgroundDataUrl);



  localStorage.setItem('recordingBackgroundEnabled', String(recordingBackgroundEnabled));



  loadRecordingBackgroundImage(recordingBackgroundDataUrl);



  syncRecordingBackgroundUI();



}







function deleteRecordingBackground(id: string) {



  if (id === MASTER_BACKGROUND_ID || id === NO_BACKGROUND_ID) return;







  const items = getManagedRecordingBackgrounds();



  const nextItems = items.filter(item => item.id !== id);



  saveCustomRecordingBackgrounds(nextItems);







  if (recordingBackgroundActiveId === id) {



    selectRecordingBackground(nextItems[0]);



  } else {



    syncRecordingBackgroundUI();



  }



}







function renderRecordingBackgroundList() {



  const list = document.getElementById('record-bg-list');



  if (!list) return;







  const items = getManagedRecordingBackgrounds();



  if (!items.some(item => item.id === recordingBackgroundActiveId)) {



    recordingBackgroundActiveId = NO_BACKGROUND_ID;



    recordingBackgroundDataUrl = '';



    recordingBackgroundEnabled = false;



    localStorage.setItem('recordingBackgroundActiveId', recordingBackgroundActiveId);



    localStorage.setItem('recordingBackgroundDataUrl', recordingBackgroundDataUrl);



    localStorage.setItem('recordingBackgroundEnabled', 'false');



    loadRecordingBackgroundImage(recordingBackgroundDataUrl);



  }







  list.innerHTML = '';



  items.forEach(item => {



    const card = document.createElement('button');



    card.type = 'button';



    card.className = `record-bg-card${item.id === recordingBackgroundActiveId ? ' active' : ''}`;



    card.title = item.name;



    card.addEventListener('click', () => selectRecordingBackground(item));







    const thumb = document.createElement('div');



    thumb.className = `record-bg-card-thumb${item.id === NO_BACKGROUND_ID ? ' no-bg' : ''}`;



    if (item.src) thumb.style.backgroundImage = `url("${item.src}")`;



    card.appendChild(thumb);







    const name = document.createElement('div');



    name.className = 'record-bg-card-name';



    name.textContent = item.name;



    card.appendChild(name);







    if (!item.builtin) {



      const del = document.createElement('button');



      del.type = 'button';



      del.className = 'record-bg-card-delete';



      del.textContent = '×';



      del.title = `删除 ${item.name}`;



      del.addEventListener('click', event => {



        event.stopPropagation();



        deleteRecordingBackground(item.id);



      });



      card.appendChild(del);



    }







    list.appendChild(card);



  });







  const uploadCard = document.createElement('button');



  uploadCard.type = 'button';



  uploadCard.className = 'record-bg-card record-bg-upload-card';



  uploadCard.title = '上传背景';



  uploadCard.addEventListener('click', () => {



    const fileInput = document.getElementById('input-record-bg-file') as HTMLInputElement | null;



    fileInput?.click();



  });







  const uploadThumb = document.createElement('div');



  uploadThumb.className = 'record-bg-card-thumb upload-bg';



  uploadCard.appendChild(uploadThumb);







  const uploadName = document.createElement('div');



  uploadName.className = 'record-bg-card-name';



  uploadName.textContent = '上传';



  uploadCard.appendChild(uploadName);







  list.appendChild(uploadCard);



}







function syncRecordingBackgroundUI() {



  const checkbox = document.getElementById('input-record-bg') as HTMLInputElement | null;



  const controls = document.getElementById('record-bg-controls');



  const preview = document.getElementById('record-bg-preview');



  const status = document.getElementById('record-bg-status');



  const boardWrapper = document.getElementById('board-wrapper');







  if (checkbox) checkbox.checked = recordingBackgroundEnabled;



  if (controls) controls.classList.add('active');



  if (preview) {



    if (recordingBackgroundDataUrl) {



      preview.textContent = '';



      preview.style.backgroundImage = `url("${recordingBackgroundDataUrl}")`;



      preview.style.backgroundSize = '100% 100%';



    } else {



      preview.textContent = '未选择背景?';



      preview.style.backgroundImage = '';



      preview.style.backgroundSize = '100% 100%';



    }



  }



  if (status) {



    status.classList.toggle('active', recordingBackgroundEnabled && !!recordingBackgroundDataUrl);



    if (recordingBackgroundEnabled && recordingBackgroundDataUrl) {



      status.textContent = '已启用背景图';



    } else if (recordingBackgroundDataUrl) {



      status.textContent = '已选择背景图';



    } else {



      status.textContent = '未启用背景图';



    }



  }



  if (boardWrapper) {



    const showLiveBackground = recordingBackgroundEnabled && !!recordingBackgroundDataUrl;

    const useGeneratedBackgroundUI = showLiveBackground;



      boardWrapper.classList.toggle('record-bg-live', showLiveBackground);

      boardWrapper.classList.toggle('generated-board-ui', useGeneratedBackgroundUI);



    if (showLiveBackground) {



      boardWrapper.style.backgroundImage = `url("${recordingBackgroundDataUrl}")`;



      boardWrapper.style.backgroundSize = '100% 100%';



    } else {



      boardWrapper.style.backgroundImage = '';



      boardWrapper.style.backgroundSize = '';



    }



  }



  drawGrid();

  positionPreviewCanvasInMaster();



  renderRecordingBackgroundList();



}







function drawRecordingBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {



  ctx.fillStyle = '#2e3764';



  ctx.fillRect(0, 0, width, height);







  const img = recordingBackgroundImage;



  if (!img || !recordingBackgroundImageLoaded || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;







  ctx.drawImage(img, 0, 0, width, height);



}







function drawRecordingVerticalGrid(ctx: CanvasRenderingContext2D, boardBox: { x: number; y: number; w: number; h: number }) {



  ctx.save();



  ctx.strokeStyle = 'rgba(255,255,255,0.12)';



  ctx.lineWidth = 1;



  for (let c = 1; c < PARAMS.gridCols; c++) {



    const x = Math.round(boardBox.x + (boardBox.w * c) / PARAMS.gridCols) + 0.5;



    ctx.beginPath();



    ctx.moveTo(x, boardBox.y);



    ctx.lineTo(x, boardBox.y + boardBox.h);



    ctx.stroke();



  }



  ctx.restore();



}







function getMasterBoardRect(width: number, height: number) {

  const boardWidth = MASTER_UI.board.w * width;
  const gameWidth = PARAMS.gridCols * PARAMS.cellSize + PADDING * 2;
  const gameHeight = PARAMS.viewportRows * PARAMS.cellSize + PADDING * 2;
  const boardHeight = boardWidth * (gameHeight * BOARD_FRAME_VERTICAL_SCALE / Math.max(1, gameWidth));



  return {



    x: MASTER_UI.board.x * width,



    y: MASTER_UI.board.y * height,



    w: boardWidth,



    h: boardHeight



  };



}







function getMasterBoardContentRect(width: number, height: number) {



  return getMasterBoardRect(width, height);



}







function getMasterBoardAspect(): number {



  const boardRect = getMasterBoardContentRect(MASTER_UI.width, MASTER_UI.height);



  return boardRect.h / boardRect.w;



}







function fitRectToWidthPreserveAspect(



  target: { x: number; y: number; w: number; h: number },



  contentW: number,



  contentH: number,



  verticalAlign: 'top' | 'center' | 'bottom' = 'top'



) {



  if (contentW <= 0 || contentH <= 0 || target.w <= 0 || target.h <= 0) {



    return target;



  }







  const w = target.w;



  const h = target.h;



  return {



    x: target.x,



    y:



      verticalAlign === 'top'



        ? target.y



        : verticalAlign === 'bottom'



          ? target.y + target.h - h



          : target.y + (target.h - h) / 2,



    w,



    h



  };



}







function getPreviewContentSize() {



  const rendererScreen = app?.renderer?.screen;



  return {



    w: rendererScreen?.width || PARAMS.gridCols * PARAMS.cellSize + PADDING * 2,



    h: rendererScreen?.height || PARAMS.viewportRows * PARAMS.cellSize + PADDING * 2



  };



}







function positionPreviewCanvasInMaster() {



  const boardClip = document.getElementById('board-clip');



  if (!boardClip || !app?.canvas) return;







  const canvas = app.canvas as HTMLCanvasElement;



  const contentSize = getPreviewContentSize();



  const targetWidth = boardClip.clientWidth;



  const targetHeight = boardClip.clientHeight;



  const rect = fitRectToWidthPreserveAspect(



    { x: 0, y: 0, w: targetWidth, h: targetHeight },



    contentSize.w,



    contentSize.h,



    'top'



  );



  canvas.style.left = `${rect.x}px`;



  canvas.style.top = `${rect.y}px`;



  canvas.style.width = `${rect.w}px`;



  canvas.style.height = `${rect.h}px`;



}







// ---- UI DOM Bindings ----



function setupDOMUI() {



  setupShatterModeButtons();



  loadRecordingBackgroundImage(recordingBackgroundDataUrl);



  syncRecordingBackgroundUI();







  const vocalPackButtons = document.querySelectorAll<HTMLButtonElement>('.voice-pack-btn');



  vocalPackButtons.forEach(button => {



    button.addEventListener('click', () => {



      const pack = button.dataset.voicePack;



      if (pack === 'male' || pack === 'female') {



        applyVocalPack(pack);



      }



    });



  });



  syncVocalPackUI();







  // 破碎颜色 selector 绑定与初始化



  const selectShatterColor = document.getElementById('select-shatter-color') as HTMLSelectElement;



  if (selectShatterColor) {



    const savedColor = localStorage.getItem('shatterColor') || 'default';



    selectShatterColor.value = savedColor;



    selectShatterColor.addEventListener('change', () => {



      localStorage.setItem('shatterColor', selectShatterColor.value);



    });



  }







  // 隐藏文案 checkbox



  const hideTextCheckbox = document.getElementById('input-hidetext') as HTMLInputElement;



  if (hideTextCheckbox) {



    const gameHeader = document.getElementById('game-header');



    hideTextCheckbox.addEventListener('change', () => {



      if (gameHeader) {



        gameHeader.style.display = hideTextCheckbox.checked ? 'none' : '';



      }



    });



  }







  const recordBgCheckbox = document.getElementById('input-record-bg') as HTMLInputElement | null;



  const recordBgFile = document.getElementById('input-record-bg-file') as HTMLInputElement | null;



  const recordBgClear = document.getElementById('btn-record-bg-clear') as HTMLButtonElement | null;







  recordBgCheckbox?.addEventListener('change', () => {



    if (!recordBgCheckbox.checked) {



      selectRecordingBackground(getManagedRecordingBackgrounds()[0]);



      return;



    }







    const items = getManagedRecordingBackgrounds();



    const activeItem = items.find(item => item.id === recordingBackgroundActiveId && item.src);



    selectRecordingBackground(activeItem || items.find(item => item.id !== NO_BACKGROUND_ID && item.src) || items[0]);



  });







  recordBgFile?.addEventListener('change', () => {



    const file = recordBgFile.files?.[0];



    if (!file) return;







    const reader = new FileReader();



    reader.onload = () => {



      const src = String(reader.result || '');



      if (!src) return;







      const items = getManagedRecordingBackgrounds();



            const item: ManagedRecordingBackground = {

        id: `custom-${Date.now()}`,

        name: file.name.replace(/\.[^.]+$/, '') || '自定义背景',

        src

      };



      saveCustomRecordingBackgrounds([...items, item]);



      selectRecordingBackground(item);



      recordBgFile.value = '';



    };



    reader.readAsDataURL(file);



  });







  recordBgClear?.addEventListener('click', () => {



    selectRecordingBackground(getManagedRecordingBackgrounds()[0]);



  });







  // Level/Score 输入框同步到游戏画面



  const inputLevel = document.getElementById('input-level') as HTMLInputElement;



  const inputScore = document.getElementById('input-score') as HTMLInputElement;



  const inputCollect = document.getElementById('input-collect') as HTMLInputElement;



  if (inputLevel) {



    inputLevel.addEventListener('input', () => {



      const levelVal = document.getElementById('level-val');



      if (levelVal) levelVal.innerText = inputLevel.value;



    });



  }



  if (inputScore) {



    inputScore.addEventListener('input', () => {



      const scoreVal = document.getElementById('score-val');



      if (scoreVal) scoreVal.innerText = parseInt(inputScore.value).toLocaleString();



    });



  }



  if (inputCollect) {



    inputCollect.addEventListener('input', () => {



      collectedCount = parseInt(inputCollect.value) || 0;



      updateHeaderUI();



    });



  }







  // 缃戞牸灏哄閰嶇疆杈撳叆?



  const inputCols = document.getElementById('input-cols') as HTMLInputElement;



  const inputVpRows = document.getElementById('input-vprows') as HTMLInputElement;



  const inputRows = document.getElementById('input-rows') as HTMLInputElement;



  const inputCellSize = document.getElementById('input-cellsize') as HTMLInputElement;

  function syncGridAspectToPhoneScreen(source?: EventTarget | null) {
    const boardAspect = DEFAULT_BOARD_ROWS / DEFAULT_BOARD_COLS;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const setValue = (id: string, value: number) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = String(value);
    };
    const setText = (id: string, value: number) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value);
    };

    const sourceId = source instanceof HTMLElement ? source.id : '';
    let cols = parseInt(inputCols?.value || String(PARAMS.gridCols), 10) || PARAMS.gridCols;
    let rows = parseInt(inputVpRows?.value || String(PARAMS.viewportRows), 10) || PARAMS.viewportRows;

    if (sourceId === 'input-vprows' || sourceId === 'slider-vprows' || sourceId === 'input-rows' || sourceId === 'slider-rows') {
      rows = clamp(rows, 6, 60);
      cols = clamp(Math.round(rows / boardAspect), 4, 30);
      rows = clamp(Math.round(cols * boardAspect), 6, 60);
    } else {
      cols = clamp(cols, 4, 30);
      rows = clamp(Math.round(cols * boardAspect), 6, 60);
    }

    PARAMS.gridCols = cols;
    PARAMS.viewportRows = rows;
    PARAMS.totalRows = rows;

    setValue('input-cols', cols);
    setValue('slider-cols', cols);
    setText('val-cols', cols);
    setValue('input-vprows', rows);
    setValue('slider-vprows', rows);
    setText('val-vprows', rows);
    setValue('input-rows', rows);
    setValue('slider-rows', rows);
    setText('val-rows', rows);
  }







  function applyGridConfig(e?: Event) {
  (window as any).applyGridConfig = applyGridConfig;



    const previousCellSize = PARAMS.cellSize;



    const currentScrollRow = worldContainer



      ? getScrollRowFromWorldY(worldContainer.y, previousCellSize)



      : initialScrollRow;



    syncGridAspectToPhoneScreen(e?.target || null);



    syncBoardFrameToGrid();



    if (PARAMS.totalRows < PARAMS.viewportRows) {



      PARAMS.totalRows = PARAMS.viewportRows;



      const sliderRows = document.getElementById('slider-rows') as HTMLInputElement | null;



      const valRows = document.getElementById('val-rows');



      if (inputRows) inputRows.value = String(PARAMS.totalRows);



      if (sliderRows) sliderRows.value = String(PARAMS.totalRows);



      if (valRows) valRows.textContent = String(PARAMS.totalRows);



    }







    const container = document.getElementById('canvas-container');



    const boardWrapper = document.getElementById('board-wrapper');



    const isManualCellSize = e && (



      e.target === inputCellSize ||



      (e.target as HTMLElement).id === 'slider-cellsize' ||



      (e.target as HTMLElement).id === 'input-cellsize'



    );







    if (!isManualCellSize && container) {



      // 鑷姩璁＄畻鏈€閫傚悎鐢诲竷澶у皬鐨勬牸楂?(鏍奸?= 瀹瑰櫒鍙敤楂樺?琛屾? 瀹瑰櫒鍙敤瀹藉?鍒楁?涓殑杈冨皬?



      const wrapperW = boardWrapper?.clientWidth || container.clientWidth * 0.95;



      const wrapperH = boardWrapper?.clientHeight || container.clientHeight * 0.95;



      const boardRect = getMasterBoardContentRect(wrapperW, wrapperH);



      const maxW = boardRect.w;



      const maxH = boardRect.h;







      const cellW = maxW / PARAMS.gridCols;



      const cellH = maxH / PARAMS.viewportRows;



      



      const autoCellSize = Math.max(10, Math.floor(Math.min(cellW, cellH)));



      PARAMS.cellSize = autoCellSize;







      // 鍚屾鍒?DOM 鍏冪礌鍜屾粦?



      const sliderCellSize = document.getElementById('slider-cellsize') as HTMLInputElement | null;



      const valCellSize = document.getElementById('val-cellsize');



      if (sliderCellSize) sliderCellSize.value = String(autoCellSize);



      if (valCellSize) valCellSize.textContent = String(autoCellSize);



      if (inputCellSize) inputCellSize.value = String(autoCellSize);



    } else {



      if (inputCellSize) PARAMS.cellSize = parseInt(inputCellSize.value) || 50;



    }







    // 确保 totalRows >= viewportRows



    if (inputRows) inputRows.value = String(PARAMS.totalRows);







    // 计算目标 canvas 尺寸



    const targetW = PARAMS.gridCols * PARAMS.cellSize + PADDING * 2;







    let fitScale = 1;



    if (container) {



      const wrapperW = boardWrapper?.clientWidth || container.clientWidth * 0.95;



      const wrapperH = boardWrapper?.clientHeight || container.clientHeight * 0.95;



      const boardRect = getMasterBoardContentRect(wrapperW, wrapperH);



      const maxW = boardRect.w;



      const rawScale = Math.min(1, maxW / targetW);



      // 强制单格缩放后的尺寸为整数像素，且至少为 1



      const scaledCellSize = Math.max(1, Math.floor(PARAMS.cellSize * rawScale));



      fitScale = scaledCellSize / PARAMS.cellSize;



    }







    // 鐢ㄩ€傞厤鍚庣殑灏哄鐩存帴 resize canvas锛岀‘淇濆叾鍒氬ソ绛変簬鏍兼暟涔樹互鏁存暟鍗曟牸灏哄鍔犱笂 Padding



    const displayCellSize = Math.max(1, Math.round(PARAMS.cellSize * fitScale));
    const displayW = PARAMS.gridCols * displayCellSize + Math.round(PADDING * 2 * fitScale);
    const displayH = PARAMS.viewportRows * displayCellSize + Math.round(PADDING * 2 * fitScale);
    app.renderer.resize(displayW, displayH);






    // ?stage.scale 璁╂父鎴忓唴瀹归€傞厤缂╂斁鍚庣?canvas



    app.stage.scale.set(fitScale);







    updateBoardViewportMask();



    resetHoleMask();



    drawGrid();



    positionPreviewCanvasInMaster();



    syncRecordedScrollPixelsToCurrentCellSize();



    setWorldY(getWorldYFromScrollRow(currentScrollRow));







    // 重新定位已有方块



    blocks.forEach(b => {



      b.sprite.x = b.col * PARAMS.cellSize;



      b.sprite.y = b.row * PARAMS.cellSize;



      b.sprite.width = b.length * PARAMS.cellSize;



      b.sprite.height = PARAMS.cellSize;



    });



  }







  [inputCols, inputVpRows, inputRows, inputCellSize].forEach(input => {



    if (input) {



      input.addEventListener('input', applyGridConfig);



    }



  });







  // 婊戝??鏄剧ず鍊?+ 闅愯?input 鍚屾?



  const sliderConfigs: [string, string, string][] = [



    ['slider-cols', 'val-cols', 'input-cols'],



    ['slider-vprows', 'val-vprows', 'input-vprows'],



    ['slider-rows', 'val-rows', 'input-rows'],



    ['slider-cellsize', 'val-cellsize', 'input-cellsize'],



    ['slider-speed', 'val-speed', 'input-speed'],



    ['slider-level', 'val-level', 'input-level'],



    ['slider-score', 'val-score', 'input-score'],



    ['slider-collect', 'val-collect', 'input-collect'],



  ];



  sliderConfigs.forEach(([sliderId, valId, inputId]) => {



    const slider = document.getElementById(sliderId) as HTMLInputElement;



    const valSpan = document.getElementById(valId);



    const hiddenInput = document.getElementById(inputId) as HTMLInputElement;



    if (slider) {



      slider.addEventListener('input', () => {



        if (valSpan) valSpan.textContent = slider.value;



        if (hiddenInput) {



          hiddenInput.value = slider.value;



          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));



        }



      });



    }



  });


  applyGridConfig();







  const btnRandom = document.getElementById('btn-random')!;



  const btnDraw = document.getElementById('btn-draw')!;



  const btnManual = document.getElementById('btn-manual')!;



  const btnPlay = document.getElementById('btn-play')!;



  const btnRecord = document.getElementById('btn-record') as HTMLButtonElement | null;

  const gravityDurInput = document.getElementById('input-script-gravity-dur') as HTMLInputElement;
  if (gravityDurInput) {
    gravityDurInput.value = PARAMS.gravityDuration.toString();
    gravityDurInput.addEventListener('input', () => {
      PARAMS.gravityDuration = parseFloat(gravityDurInput.value) || 0.3;
    });
  }



  const btnGenerate = document.getElementById('btn-generate')!;



  const btnCancel = document.getElementById('btn-cancel')!;







  const btnShiftUp = document.getElementById('btn-shift-up')!;



  const btnShiftDown = document.getElementById('btn-shift-down')!;







  btnShiftDown.onclick = () => {



    if (isPlayingScript || isAnimating) return;







    if (currentMode === 'draw') {



      layoutDrawMask = normalizeBooleanMask(layoutDrawMask);



      const reachedBottom = layoutDrawMask[PARAMS.totalRows - 1].some(Boolean);



      if (reachedBottom) {



        alert('底部已到极限，无法整体下移！');



        return;



      }



      for (let r = PARAMS.totalRows - 1; r > 0; r--) {



        layoutDrawMask[r] = [...layoutDrawMask[r - 1]];



      }



      layoutDrawMask[0] = Array(PARAMS.gridCols).fill(false);



      drawHoles();



      return;



    }







    if (blocks.length === 0) return;



    



    const reachedBottom = blocks.some(b => b.row === PARAMS.totalRows - 1);



    if (reachedBottom) {



      alert('底部已有方块，无法整体下移！');



      return;



    }



    



    blocks.forEach(b => {



      b.row += 1;



      b.sprite.y = b.row * PARAMS.cellSize;



    });



    



    initialBoardBlocks.forEach(ib => {



      ib.row += 1;



    });



    



    scriptSteps.forEach(step => {



      if (step.row !== undefined) step.row += 1;



    });



    



    resetAndApplyActiveModeStyle();



    captureBoardState();



    if (isFallingMode) {



      scrollToBoardBottom();



    }



    repairScriptSteps();



    updateScriptUI();



  };







  btnShiftUp.onclick = () => {



    if (isPlayingScript || isAnimating) return;







    if (currentMode === 'draw') {



      layoutDrawMask = normalizeBooleanMask(layoutDrawMask);



      const reachedTop = layoutDrawMask[0].some(Boolean);



      if (reachedTop) {



        alert('顶部已到极限，无法整体上移！');



        return;



      }



      for (let r = 0; r < PARAMS.totalRows - 1; r++) {



        layoutDrawMask[r] = [...layoutDrawMask[r + 1]];



      }



      layoutDrawMask[PARAMS.totalRows - 1] = Array(PARAMS.gridCols).fill(false);



      drawHoles();



      return;



    }







    if (blocks.length === 0) return;



    



    const reachedTop = blocks.some(b => b.row === 0);



    if (reachedTop) {



      alert('顶部已有方块，无法整体上移！');



      return;



    }



    



    blocks.forEach(b => {



      b.row -= 1;



      b.sprite.y = b.row * PARAMS.cellSize;



    });



    



    initialBoardBlocks.forEach(ib => {



      ib.row -= 1;



    });



    



    scriptSteps.forEach(step => {



      if (step.row !== undefined) step.row -= 1;



    });



    



    resetAndApplyActiveModeStyle();



    captureBoardState();



    repairScriptSteps();



    updateScriptUI();



  };







  const bottomMenu = document.getElementById('bottom-menu')!;



  const drawMenu = document.getElementById('draw-menu')!;



  const manualMenu = document.getElementById('manual-menu')!;



  const btnManualClear = document.getElementById('btn-manual-clear')!;



  const btnManualGenerate = document.getElementById('btn-manual-generate')!;



  const btnManualCancel = document.getElementById('btn-manual-cancel')!;



  const manualBlockPalette = document.getElementById('manual-block-palette')!;







  function buildManualBlockPalette() {



    manualBlockPalette.innerHTML = '';







    if (isCollectMode) {



      const collectRow = document.createElement('div');



      collectRow.className = 'palette-row';



      collectRow.style.justifyContent = 'center';



      collectRow.style.marginBottom = '12px';



      collectRow.style.borderBottom = '1px solid #444';



      collectRow.style.paddingBottom = '8px';







      const btn = document.createElement('div');



      btn.className = 'palette-block-btn active'; // Active by default in collect mode



      btn.innerText = '🎁';



      btn.style.background = 'linear-gradient(135deg, #ffd700, #ff8c00)';



      btn.style.width = '24px';



      btn.title = '收集?(1x1)';







      btn.onclick = () => {



        document.querySelectorAll('.palette-block-btn').forEach(el => el.classList.remove('active'));



        btn.classList.add('active');



        manualSelectedBlock = { length: 1, color: 'collectible' };







        initOrUpdateManualPreviewSprite(1, 'collectible', false);



      };







      collectRow.appendChild(btn);



      manualBlockPalette.appendChild(collectRow);



      manualSelectedBlock = { length: 1, color: 'collectible' };



    }







        // Prop (Peppermint Machine) palette row



    const propSection = document.createElement('div');



    propSection.className = 'palette-prop-section';



    propSection.style.marginBottom = '12px';



    propSection.style.borderBottom = '1px solid #444';



    propSection.style.paddingBottom = '8px';







    const propTitle = document.createElement('div');



    propTitle.innerText = '🍬 机器糖果棒道具';



    propTitle.style.color = '#ff99aa';



    propTitle.style.fontSize = '12px';



    propTitle.style.fontWeight = 'bold';



    propTitle.style.textAlign = 'center';



    propTitle.style.marginBottom = '6px';



    propSection.appendChild(propTitle);







    // Direction selector row



    const dirRow = document.createElement('div');



    dirRow.className = 'palette-row';



    dirRow.style.justifyContent = 'center';



    dirRow.style.gap = '6px';



    dirRow.style.marginBottom = '6px';







    let selectedPropDir: 'left' | 'right' = 'left';







    const btnDirLeft = document.createElement('button');



    btnDirLeft.className = 'btn-prop-dir active';



    btnDirLeft.innerText = '⬅️ 向右机器 (向左延展)';



    btnDirLeft.style.fontSize = '11px';



    btnDirLeft.style.padding = '3px 8px';



    btnDirLeft.style.background = '#443366';



    btnDirLeft.style.color = '#fff';



    btnDirLeft.style.border = '1px solid #7755aa';



    btnDirLeft.style.borderRadius = '4px';



    btnDirLeft.style.cursor = 'pointer';







    const btnDirRight = document.createElement('button');



    btnDirRight.className = 'btn-prop-dir';



    btnDirRight.innerText = '➡️ 向左机器 (向右延展)';



    btnDirRight.style.fontSize = '11px';



    btnDirRight.style.padding = '3px 8px';



    btnDirRight.style.background = '#222';



    btnDirRight.style.color = '#aaa';



    btnDirRight.style.border = '1px solid #444';



    btnDirRight.style.borderRadius = '4px';



    btnDirRight.style.cursor = 'pointer';







    btnDirLeft.onclick = () => {



      selectedPropDir = 'left';



      btnDirLeft.style.background = '#443366';



      btnDirLeft.style.color = '#fff';



      btnDirRight.style.background = '#222';



      btnDirRight.style.color = '#aaa';



      if (manualSelectedBlock && manualSelectedBlock.color === 'prop-peppermint') {



        manualSelectedBlock.propDir = 'left';



        initOrUpdateManualPreviewSprite(manualSelectedBlock.length, 'prop-peppermint', false, 'left');



      }



    };







    btnDirRight.onclick = () => {



      selectedPropDir = 'right';



      btnDirRight.style.background = '#443366';



      btnDirRight.style.color = '#fff';



      btnDirLeft.style.background = '#222';



      btnDirLeft.style.color = '#aaa';



      if (manualSelectedBlock && manualSelectedBlock.color === 'prop-peppermint') {



        manualSelectedBlock.propDir = 'right';



        initOrUpdateManualPreviewSprite(manualSelectedBlock.length, 'prop-peppermint', false, 'right');



      }



    };







    dirRow.appendChild(btnDirLeft);



    dirRow.appendChild(btnDirRight);



    propSection.appendChild(dirRow);







    // Length selector row



    const lenRow = document.createElement('div');



    lenRow.className = 'palette-row';



    lenRow.style.justifyContent = 'center';



    lenRow.style.gap = '4px';







    [2, 3, 4, 5, 6].forEach(l => {



      const btn = document.createElement('div');



      btn.className = 'palette-block-btn';



      btn.innerText = `${l}格`;



      btn.style.background = 'linear-gradient(135deg, #ff3366, #990033)';



      btn.style.width = `${Math.max(24, l * 12 + 12)}px`;



      btn.style.fontSize = '11px';



      btn.title = `放置 ${l} 格机器糖果棒`;







      btn.onclick = () => {



        document.querySelectorAll('.palette-block-btn').forEach(el => el.classList.remove('active'));



        btn.classList.add('active');



        manualSelectedBlock = { length: l, color: 'prop-peppermint', propDir: selectedPropDir };



        initOrUpdateManualPreviewSprite(l, 'prop-peppermint', false, selectedPropDir);



      };







      lenRow.appendChild(btn);



    });







    propSection.appendChild(lenRow);



    manualBlockPalette.appendChild(propSection);







    const colors = ['red', 'blue', 'green', 'yellow', 'pink'];



    const colorGradients: Record<string, string> = {



      red: 'linear-gradient(135deg, #ff4b72, #d9264c)',



      blue: 'linear-gradient(135deg, #4da3ff, #1a75ff)',



      green: 'linear-gradient(135deg, #33cc66, #1f9947)',



      yellow: 'linear-gradient(135deg, #ffdb4d, #e6b800)',



      pink: 'linear-gradient(135deg, #ff66cc, #cc3399)'



    };



    



    colors.forEach(c => {



      const row = document.createElement('div');



      row.className = 'palette-row';



      row.style.justifyContent = 'center'; // Center the row items



      



      [1, 2, 3, 4].forEach(l => {



        const btn = document.createElement('div');



        btn.className = 'palette-block-btn';



        btn.innerText = l.toString();



        btn.style.background = colorGradients[c];



        



        const widths: Record<number, number> = { 1: 18, 2: 32, 3: 46, 4: 60 };



        btn.style.width = `${widths[l]}px`;



        



        btn.onclick = () => {



          document.querySelectorAll('.palette-block-btn').forEach(el => el.classList.remove('active'));



          btn.classList.add('active');



          manualSelectedBlock = { length: l, color: c };



          



          initOrUpdateManualPreviewSprite(l, c, false);



        };



        



        if (!isCollectMode && c === 'red' && l === 2) {



          btn.classList.add('active');



          manualSelectedBlock = { length: l, color: c };



        }



        



        row.appendChild(btn);



      });



      



      manualBlockPalette.appendChild(row);



    });



  }







  btnManual.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    currentMode = 'manual';



    manualInitialStateSnapshot = JSON.stringify(blocks.map(b => ({



      id: b.id,



      col: b.col,



      row: b.row,



      length: b.length,



      color: b.color,



      noGravity: b.noGravity,



      isCollectible: b.isCollectible,



      isProp: b.isProp,



      propType: b.propType,

        propDir: b.propDir



    })));



    bottomMenu.classList.add('hidden');



    manualMenu.classList.remove('hidden');



    buildManualBlockPalette();



    



    const defaultColor = isCollectMode ? 'collectible' : 'red';



    const defaultLength = isCollectMode ? 1 : 2;



    initOrUpdateManualPreviewSprite(defaultLength, defaultColor, false);



    setWorldY(0);



    document.getElementById('game-over-text')!.style.display = 'none';



    positionPreviewCanvasInMaster();



  };







  btnManualGenerate.onclick = () => {



    currentMode = 'play';



    if (isFallingMode) {



      isFixedBoardMode = false;



    }



    syncModeButtonsUI();



    



    manualMenu.classList.add('hidden');



    bottomMenu.classList.remove('hidden');



    if (manualPreviewSprite) {



      blocksContainer.removeChild(manualPreviewSprite);



      manualPreviewSprite.destroy();



      manualPreviewSprite = null;



    }



    resetAndApplyActiveModeStyle();



    captureBoardState();



    repairScriptSteps();



    if (isNoGravityMode) {



      detectFloatingBlocks();



    } else {



      isAnimating = false;



      applyGravity(true);



    }



    positionPreviewCanvasInMaster();



  };







  btnManualCancel.onclick = () => {



    clearAllBlocks();



    if (manualInitialStateSnapshot) {



      const savedBlocks = JSON.parse(manualInitialStateSnapshot);



      savedBlocks.forEach((sb: any) => {



        spawnBlock(sb.col, sb.row, sb.length, sb.color, sb.id, sb.noGravity, sb.isCollectible, sb.isProp, sb.propType, sb.propDir || 'left');



      });



    }



    currentMode = 'play';



    manualMenu.classList.add('hidden');



    bottomMenu.classList.remove('hidden');



    if (manualPreviewSprite) {



      blocksContainer.removeChild(manualPreviewSprite);



      manualPreviewSprite.destroy();



      manualPreviewSprite = null;



    }



    positionPreviewCanvasInMaster();



  };







  btnManualClear.onclick = () => {



    clearAllBlocks();



  };







  btnRandom.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    isGameStarted = false;



    btnPlay.innerHTML = '<span class="icon">▶</span>开始游戏';



    gameTime = 0;



    const timeDisplay = document.getElementById('time-display');
    if (timeDisplay) timeDisplay.innerText = '0.0s';



    document.getElementById('game-over-text')!.style.display = 'none';



    positionPreviewCanvasInMaster();



    stopGameplayModeTimer();



    applyBoardAdvanceMode(boardAdvanceMode);



    syncModeButtonsUI();







    console.log('btnRandom clicked. Start blocks count:', blocks.length);



    comboCount = 0; hasAnyEliminationThisStep = false;



    generateRandomLayout();



    console.log('After generateRandomLayout, blocks count:', blocks.length);



    runPhysicsInstant();



    setWorldY(0);



    console.log('After runPhysicsInstant, blocks count:', blocks.length);



    resetAndApplyActiveModeStyle();



    captureBoardState();



    console.log('After captureBoardState, blocks count:', blocks.length);



    drawHoles(); // Keep board shape visible



    positionPreviewCanvasInMaster();



    console.log('After resetAndApplyActiveModeStyle, blocks count:', blocks.length);



  };







  btnDraw.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    currentMode = 'draw';



    clearAllBlocks();



    layoutDrawMask = normalizeBooleanMask(layoutDrawMask);



    bottomMenu.classList.add('hidden');



    drawMenu.classList.remove('hidden');



    drawHoles();



    setWorldY(0);



    positionPreviewCanvasInMaster();



    document.getElementById('game-over-text')!.style.display = 'none';



  };







  btnGenerate.onclick = () => {



    currentMode = 'play';



    comboCount = 0;



    hasAnyEliminationThisStep = false;



    if (isFallingMode) {



      isFixedBoardMode = false;



    } else {



      applyBoardAdvanceMode(boardAdvanceMode);



    }



    syncModeButtonsUI();







    generateFromHoles();



    drawMenu.classList.add('hidden');



    bottomMenu.classList.remove('hidden');



    holeGraphics.clear();



    drawHoles(); // Switches back to play-mode rendering



    document.getElementById('game-over-text')!.style.display = 'none';



    if (isNoGravityMode) {



      preventFullRows();



      detectFloatingBlocks();



    } else {



      settleLayoutWithoutEliminations();



    }



    resetAndApplyActiveModeStyle();



    captureBoardState();



    if (isFallingMode) {



      scrollToBoardBottom();



    }



    positionPreviewCanvasInMaster();



  };







  btnCancel.onclick = () => {



    currentMode = 'play';



    resetLayoutDrawMask(); // Clear temporary layout mask



    drawMenu.classList.add('hidden');



    bottomMenu.classList.remove('hidden');



    holeGraphics.clear();



    drawBoardShapeBg();



    drawHoles(); // Keep board shape visible



    document.getElementById('game-over-text')!.style.display = 'none';



    positionPreviewCanvasInMaster();



  };







  // ---- Board Shape Editor ----



  const boardEditorMenu = document.getElementById('board-editor-menu')!;



  const btnBoardEditor = document.getElementById('btn-board-editor')!;



  const btnBoardEditorDone = document.getElementById('btn-board-editor-done')!;



  const btnBoardEditorClear = document.getElementById('btn-board-editor-clear')!;



  const btnBoardEditorCancel = document.getElementById('btn-board-editor-cancel')!;



  let boardEditorBackupMask: boolean[][] = [];







  btnBoardEditor.onclick = () => {



    // 榛樿鐨勫皢鎬昏鏁拌皟鏁存垚鍜岃鏁颁竴鑷?



    applyGridConfig();







    boardEditorBackupMask = holeMask.map(row => [...row]);



    // If no existing custom shape, start with blank canvas (all holes)



    if (!hasCustomBoardShape()) {



      holeMask = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(true));



    }



    currentMode = 'board-edit';



    bottomMenu.classList.add('hidden');



    boardEditorMenu.classList.remove('hidden');



    drawHoles();



    positionPreviewCanvasInMaster();



    document.getElementById('game-over-text')!.style.display = 'none';



  };







  btnBoardEditorDone.onclick = () => {



    currentMode = 'play';



    boardEditorMenu.classList.add('hidden');



    bottomMenu.classList.remove('hidden');



    drawHoles();







    // Scroll viewport to show only the board shape area



    if (hasCustomBoardShape()) {



      let bottomRow = 0;



      for (let r = 0; r < PARAMS.totalRows; r++) {



        for (let c = 0; c < PARAMS.gridCols; c++) {



          if (!holeMask[r] || !holeMask[r][c]) {



            if (r > bottomRow) bottomRow = r;



          }



        }



      }



      // Align so the bottom of the board is at the bottom of the viewport



      const boardBottomY = (bottomRow + 1) * PARAMS.cellSize;



      const viewportHeight = getViewportGameHeight();



      const scrollY = Math.min(0, viewportHeight - boardBottomY);



      setWorldY(scrollY);



    }



    positionPreviewCanvasInMaster();



  };







  btnBoardEditorClear.onclick = () => {



    holeMask = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(true));



    drawHoles();



  };







  btnBoardEditorCancel.onclick = () => {



    holeMask = boardEditorBackupMask;



    currentMode = 'play';



    boardEditorMenu.classList.add('hidden');



    bottomMenu.classList.remove('hidden');



    drawHoles();



    positionPreviewCanvasInMaster();



  };











  btnPlay.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    comboCount = 0;



    hasAnyEliminationThisStep = false;



    if (isGameStarted) {



      isGameStarted = false;



      stopGameplayModeTimer();



      btnPlay.innerHTML = '<span class="icon">▶</span>开始游戏';



      gameTime = 0;



      const timeDisplay = document.getElementById('time-display');
      if (timeDisplay) timeDisplay.innerText = '0.0s';



      positionPreviewCanvasInMaster();



    } else {



      isGameStarted = true;



      if (!isFallingMode) stopGameplayModeTimer();



      btnPlay.innerHTML = '<span class="icon">⏸</span>暂停游戏';



      document.getElementById('game-over-text')!.style.display = 'none';



      if (isFallingMode) {



        scrollToBoardBottom();



      } else if (boardAdvanceMode === 'scroll') {



        continuousScrollOffset = 0;



        setWorldY(0);



      } else {



        setWorldY(0);



      }



      gameTime = 0;



      const timeDisplay = document.getElementById('time-display');
      if (timeDisplay) timeDisplay.innerText = '0.0s';



      positionPreviewCanvasInMaster();



    }



  };







  btnRecord?.addEventListener('click', () => {



    if (isRecording) {



      stopRecording();



    } else if (isRecordingArmedForPlayback) {



      cancelArmedRecording();



    } else if (scriptSteps.length > 0 && !isPlayingScript) {



      armRecordingForPlayback();



    } else {



      startRecording();



    }



  });







  // Script Editor Panel UI Bindings



  const btnScriptRecord = document.getElementById('btn-script-record');



  const btnScriptPlay = document.getElementById('btn-script-play');



  const btnScriptRisingPlay = document.getElementById('btn-script-rising-play');



  const btnScriptPlayScroll = document.getElementById('btn-script-play-scroll');



  const btnScriptReset = document.getElementById('btn-script-reset');



  const btnScriptClear = document.getElementById('btn-script-clear');







  if (btnScriptRecord) {



    btnScriptRecord.onclick = async () => {



      if (isPlayingScript) return;



      if (isRecordingSteps) {



        isRecordingSteps = false;



        btnScriptRecord.innerText = '⏺ 开始录制';



        btnScriptRecord.style.background = '#d93838';



      } else {



        await waitForPhysics();



        isRecordingSteps = true;



        btnScriptRecord.innerText = '⏹ 停止录制';



        btnScriptRecord.style.background = '#4a4a5e';



        // Stopping and continuing a recording must retain its original start.



        // Clearing all steps is the explicit way to begin from a new board.



        if (scriptSteps.length === 0 || initialBoardBlocks.length === 0) {



          captureBoardState();



        }



      }



    };



  }







  if (btnScriptPlay) {



    btnScriptPlay.onclick = () => {



      if (isRecordingSteps) return;



      if (isPlayingScript) {



        scriptPlaybackStopRequested = true;



      } else {



        playScriptFromButton(false, false);



      }



    };



  }







  if (btnScriptRisingPlay) {



    btnScriptRisingPlay.onclick = () => {



      if (isRecordingSteps) return;



      if (isPlayingScript) {



        scriptPlaybackStopRequested = true;



      } else {



        playScriptFromButton(false, true);



      }



    };



  }







  if (btnScriptPlayScroll) {



    btnScriptPlayScroll.onclick = () => {



      if (isRecordingSteps) return;



      if (isPlayingScript) {



        scriptPlaybackStopRequested = true;



      } else {



        playScriptFromButton(true, false);



      }



    };



  }







  if (btnScriptReset) {



    btnScriptReset.onclick = async () => {



      if (isPlayingScript || isRecordingSteps) return;



      await waitForPhysics();



      cancelArmedRecording();



      restoreBoardState();



      selectedStepIndex = null;



      highlightStepUI(null);



    };



  }







  if (btnScriptClear) {



    btnScriptClear.onclick = async () => {



      if (isPlayingScript || isRecordingSteps) return;



      await waitForPhysics();



      cancelArmedRecording();



      scriptSteps = [];



      selectedStepIndex = null;



      updateScriptUI();



      restoreBoardState();



    };



  }







  function syncColorDotsUI() {



    const dots1 = document.querySelectorAll('#dots-color1 .color-dot');



    dots1.forEach(dot => {



      const col = dot.getAttribute('data-color');



      if (col === selectedTwoColors[0]) dot.classList.add('active');



      else dot.classList.remove('active');



    });







    const dots2 = document.querySelectorAll('#dots-color2 .color-dot');



    dots2.forEach(dot => {



      const col = dot.getAttribute('data-color');



      if (col === selectedTwoColors[1]) dot.classList.add('active');



      else dot.classList.remove('active');



    });



  }















  const dots1 = document.querySelectorAll('#dots-color1 .color-dot');



  dots1.forEach(dot => {



    dot.addEventListener('click', () => {



      selectedTwoColors[0] = dot.getAttribute('data-color') || 'red';



      if (!isCustomTwoColorMode) {



        document.getElementById('btn-custom-twocolor-mode')?.click();



      } else {



        syncColorDotsUI();



        applyCurrentTwoColors();



      }



    });



  });







  const dots2 = document.querySelectorAll('#dots-color2 .color-dot');



  dots2.forEach(dot => {



    dot.addEventListener('click', () => {



      selectedTwoColors[1] = dot.getAttribute('data-color') || 'blue';



      if (!isCustomTwoColorMode) {



        document.getElementById('btn-custom-twocolor-mode')?.click();



      } else {



        syncColorDotsUI();



        applyCurrentTwoColors();



      }



    });



  });







  const btnNormalMode = document.getElementById('btn-normal-mode')!;



  const btnFixedMechanic = document.getElementById('btn-fixed-mechanic')!;



  const btnRisingMechanic = document.getElementById('btn-rising-mechanic')!;



  const btnScrollMechanic = document.getElementById('btn-scroll-mechanic')!;



  const btnFallingMode = document.getElementById('btn-falling-mode')!;



  const btnColorMode = document.getElementById('btn-color-mode')!;



  const btnSingleColorMode = document.getElementById('btn-single-color-mode')!;



  const btnCustomTwoColorMode = document.getElementById('btn-custom-twocolor-mode')!;



  const btnRainbowMode = document.getElementById('btn-rainbow-mode')!;



  const btnRainbowFixedMode = document.getElementById('btn-rainbow-fixed-mode')!;



  const btnMaterialMode = document.getElementById('btn-material-mode')!;



  const btnCollectMode = document.getElementById('btn-collect-mode')!;



  const btnNoGravityMode = document.getElementById('btn-nogravity-mode')!;







  const btnDrawNormal = document.getElementById('btn-draw-normal')!;



  const btnDrawNoGravity = document.getElementById('btn-draw-nogravity')!;



  const btnDrawCollect = document.getElementById('btn-draw-collect')!;



  const btnManualNormal = document.getElementById('btn-manual-normal')!;



  const btnManualNoGravity = document.getElementById('btn-manual-nogravity')!;



  const btnManualCollect = document.getElementById('btn-manual-collect')!;



  function syncGravityModeUI() {



    if (isNoGravityMode) {



      btnNoGravityMode.classList.remove('gray');



      btnNoGravityMode.classList.add('blue');



      btnNormalMode.classList.remove('blue');



      btnNormalMode.classList.add('gray');







      btnDrawNoGravity.classList.remove('gray');



      btnDrawNoGravity.classList.add('blue');



      btnDrawNormal.classList.remove('blue');



      btnDrawNormal.classList.add('gray');







      btnManualNoGravity.classList.remove('gray');



      btnManualNoGravity.classList.add('blue');



      btnManualNormal.classList.remove('blue');



      btnManualNormal.classList.add('gray');



    } else {



      btnNoGravityMode.classList.remove('blue');



      btnNoGravityMode.classList.add('gray');







      btnDrawNoGravity.classList.remove('blue');



      btnDrawNoGravity.classList.add('gray');



      btnDrawNormal.classList.remove('gray');



      btnDrawNormal.classList.add('blue');







      btnManualNoGravity.classList.remove('blue');



      btnManualNoGravity.classList.add('gray');



      btnManualNormal.classList.remove('gray');



      btnManualNormal.classList.add('blue');







      if (!isColorChangingMode && !isSingleColorMode && !isRainbowMode && !isRainbowFixedMode && !isMaterialChangingMode) {



        btnNormalMode.classList.remove('gray');



        btnNormalMode.classList.add('blue');



      }



    }



  }







  syncModeButtonsUI = () => {



    const setBtnActive = (btn: HTMLElement | null, active: boolean) => {



      if (!btn) return;



      if (active) {



        btn.classList.remove('gray');



        btn.classList.add('blue');



      } else {



        btn.classList.remove('blue');



        btn.classList.add('gray');



      }



    };







    const isNormal = !isCollectMode && !isColorChangingMode && !isSingleColorMode && 



                      !isCustomTwoColorMode && !isRainbowMode && !isRainbowFixedMode && 



                      !isMaterialChangingMode;







    setBtnActive(btnNormalMode, isNormal);



    const activeMechanic = getActiveBoardMechanic();



    setBtnActive(btnFixedMechanic, activeMechanic === 'fixed');



    setBtnActive(btnRisingMechanic, activeMechanic === 'rising');



    setBtnActive(btnScrollMechanic, activeMechanic === 'scroll');



    setBtnActive(btnFallingMode, activeMechanic === 'falling');



    setBtnActive(btnColorMode, isColorChangingMode);



    setBtnActive(btnCustomTwoColorMode, isCustomTwoColorMode);



    setBtnActive(btnRainbowMode, isRainbowMode);



    setBtnActive(btnRainbowFixedMode, isRainbowFixedMode);



    setBtnActive(btnMaterialMode, isMaterialChangingMode);



    setBtnActive(btnSingleColorMode, isSingleColorMode);



    setBtnActive(btnCollectMode, isCollectMode);



    setBtnActive(btnNoGravityMode, isNoGravityMode);



    setBtnActive(btnDrawCollect, isCollectMode);



    setBtnActive(btnManualCollect, isCollectMode);







    if (btnColorMode) {



      if (isColorChangingMode) {



        const pair = COLOR_PAIRS[colorPairIndex % COLOR_PAIRS.length];



        btnColorMode.innerHTML = `<span class="icon">🎨</span>变色: ${getColorLabel(pair[0])}/${getColorLabel(pair[1])}`;



      } else {



        btnColorMode.innerHTML = '<span class="icon">🎨</span>变色模式';



      }



    }







    if (btnSingleColorMode) {



      if (isSingleColorMode) {



        const color = SINGLE_COLORS[singleColorIndex % SINGLE_COLORS.length];



        btnSingleColorMode.innerHTML = `<span class="icon">🎨</span>单色: ${getColorLabel(color)}`;



      } else {



        btnSingleColorMode.innerHTML = '<span class="icon">🎨</span>单色变色';



      }



    }







    syncColorDotsUI();



    syncGravityModeUI();



    updateHeaderUI();



    repairChineseUI();



  };



  applyBoardAdvanceMode(boardAdvanceMode);



  function setGravityMode(noGravity: boolean) {



    if (noGravity && getActiveBoardMechanic() === 'falling') {



      alert('下落玩法需要重力；请先切换到固定、无限上升或匀速滚动。');



      return;



    }



    if (isNoGravityMode === noGravity) return;



    isNoGravityMode = noGravity;



    syncGravityModeUI();



    if (isNoGravityMode) {



      detectFloatingBlocks();



    } else {



      blocks.forEach(b => b.noGravity = false);



      runPhysicsInstant();



    }



  }







  btnDrawNormal.onclick = () => setGravityMode(false);



  btnDrawNoGravity.onclick = () => setGravityMode(true);



  btnManualNormal.onclick = () => setGravityMode(false);



  btnManualNoGravity.onclick = () => setGravityMode(true);







  async function toggleCollectModeInEdit() {



    if (isCollectMode) {



      deactivateCollectMode();



    } else {



      isCollectMode = true;



      collectedCount = 0;



      await updateActiveCollectible();



    }



    syncModeButtonsUI();



    if (currentMode === 'manual') {



      buildManualBlockPalette();



      if (isCollectMode) {



        manualSelectedBlock = { length: 1, color: 'collectible' };



        initOrUpdateManualPreviewSprite(1, 'collectible', false);



      } else {



        manualSelectedBlock = { length: 2, color: 'red' };



        initOrUpdateManualPreviewSprite(2, 'red', false);



      }



    }



  }







  btnDrawCollect.onclick = () => toggleCollectModeInEdit();



  btnManualCollect.onclick = () => toggleCollectModeInEdit();







  btnNormalMode.onclick = async () => {



    stopGameplayModeTimer();



    deactivateCollectMode();



    isColorChangingMode = false;



    isSingleColorMode = false;



    isCustomTwoColorMode = false;



    btnColorMode.innerHTML = '<span class="icon">🎨</span>变色模式';



    btnSingleColorMode.innerHTML = '<span class="icon">🎨</span>单色变色';



    btnCustomTwoColorMode.classList.remove('blue');



    btnCustomTwoColorMode.classList.add('gray');



    btnSingleColorMode.classList.remove('blue');



    btnSingleColorMode.classList.add('gray');



    // Keep color selector panel always visible







    isRainbowMode = false;



    isRainbowFixedMode = false;



    isMaterialChangingMode = false;







    // 鍏抽棴鏃犻噸鍔涙ā?



    isNoGravityMode = false;



    syncGravityModeUI();



    blocks.forEach(b => b.noGravity = false);







    btnNormalMode.classList.remove('gray');



    btnNormalMode.classList.add('blue');







    btnColorMode.classList.remove('blue');



    btnColorMode.classList.add('gray');







    btnRainbowMode.classList.remove('blue');



    btnRainbowMode.classList.add('gray');







    btnRainbowFixedMode.classList.remove('blue');



    btnRainbowFixedMode.classList.add('gray');







    btnMaterialMode.classList.remove('blue');



    btnMaterialMode.classList.add('gray');







    syncModeButtonsUI();







    // 鏅€氭ā寮忕珛鍗冲簲鐢ㄩ噸鍔涳紙鍦╝wait涔嬪墠鍚屾鎵ц?



    runPhysicsInstant();







    // 鎭㈠榛樿鏉愯川涓庨鑹诧紙寮傛?



    await restoreDefaultTextures();



    blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



      const newColor = getRandomColor();



      b.color = newColor;



      const texture = PIXI.Assets.get(`${newColor}-${b.length}`);



      if (texture) b.sprite.texture = texture;



    });



  };







  btnFixedMechanic.onclick = () => {



    setBoardMechanic('fixed');



    applyBoardAdvanceMode('fixed');



    syncModeButtonsUI();



  };



  btnRisingMechanic.onclick = () => {



    setBoardMechanic('rising');



    applyBoardAdvanceMode('rising');



    syncModeButtonsUI();



  };



  btnScrollMechanic.onclick = () => {



    setBoardMechanic('scroll');



    applyBoardAdvanceMode('scroll');



    syncModeButtonsUI();



  };



  btnFallingMode.onclick = () => {



    setBoardMechanic('falling');



    if (isFallingMode) {



      isFixedBoardMode = false;



      isNoGravityMode = false;



      blocks.forEach(b => b.noGravity = false);



      scrollToBoardBottom();



      if (blocks.length === 0) {



        spawnFallingTopPage();



      } else {



        applyGravity(true);



      }



    } else {



      applyBoardAdvanceMode(boardAdvanceMode);



    }



    syncModeButtonsUI();



  };







  btnColorMode.onclick = async () => {



    deactivateCollectMode();



    if (isColorChangingMode) {



      colorPairIndex = (colorPairIndex + 1) % COLOR_PAIRS.length;



    } else {



      isColorChangingMode = true;



      isSingleColorMode = false;



      btnSingleColorMode.innerHTML = '<span class="icon">🎨</span>单色变色';



      isCustomTwoColorMode = false;



      isRainbowMode = false;



      isRainbowFixedMode = false;



      isMaterialChangingMode = false;







      btnNormalMode.classList.remove('blue');



      btnNormalMode.classList.add('gray');







      btnCustomTwoColorMode.classList.remove('blue');



      btnCustomTwoColorMode.classList.add('gray');







      btnSingleColorMode.classList.remove('blue');



      btnSingleColorMode.classList.add('gray');







      btnRainbowMode.classList.remove('blue');



      btnRainbowMode.classList.add('gray');







      btnRainbowFixedMode.classList.remove('blue');



      btnRainbowFixedMode.classList.add('gray');







      btnMaterialMode.classList.remove('blue');



      btnMaterialMode.classList.add('gray');







      btnColorMode.classList.remove('gray');



      btnColorMode.classList.add('blue');







      // Keep color selector panel always visible







      await restoreDefaultTextures();



      // Keep current colorPairIndex when first activating color mode



    }







    const pair = COLOR_PAIRS[colorPairIndex];



    btnColorMode.innerHTML = `<span class="icon">🎨</span>变色: ${getColorLabel(pair[0])}/${getColorLabel(pair[1])}`;







    blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



      const newColor = pair[Math.floor(Math.random() * 2)];



      b.color = newColor;



      const texture = PIXI.Assets.get(`${newColor}-${b.length}`);



      if (texture) b.sprite.texture = texture;



    });



    syncModeButtonsUI();



  };







  btnCustomTwoColorMode.onclick = async () => {



    deactivateCollectMode();



    isCustomTwoColorMode = true;



    isColorChangingMode = false;



    isSingleColorMode = false;



    btnColorMode.innerHTML = '<span class="icon">🎨</span>变色模式';



    btnSingleColorMode.innerHTML = '<span class="icon">🎨</span>单色变色';



    btnSingleColorMode.classList.remove('blue');



    btnSingleColorMode.classList.add('gray');



    isRainbowMode = false;



    isRainbowFixedMode = false;



    isMaterialChangingMode = false;







    btnNormalMode.classList.remove('blue');



    btnNormalMode.classList.add('gray');







    btnColorMode.classList.remove('blue');



    btnColorMode.classList.add('gray');







    btnCustomTwoColorMode.classList.remove('gray');



    btnCustomTwoColorMode.classList.add('blue');







    btnRainbowMode.classList.remove('blue');



    btnRainbowMode.classList.add('gray');







    btnRainbowFixedMode.classList.remove('blue');



    btnRainbowFixedMode.classList.add('gray');







    btnMaterialMode.classList.remove('blue');



    btnMaterialMode.classList.add('gray');







    // Keep color selector panel always visible



    syncColorDotsUI();







    await restoreDefaultTextures();



    applyCurrentTwoColors();



    syncModeButtonsUI();



  };







  btnRainbowMode.onclick = async () => {



    deactivateCollectMode();



    if (isRainbowMode) return;







    isRainbowMode = true;



    isColorChangingMode = false;



    isSingleColorMode = false;



    isCustomTwoColorMode = false;



    btnColorMode.innerHTML = '<span class="icon">🎨</span>变色模式';



    btnSingleColorMode.innerHTML = '<span class="icon">🎨</span>单色变色';



    btnCustomTwoColorMode.classList.remove('blue');



    btnCustomTwoColorMode.classList.add('gray');



    btnSingleColorMode.classList.remove('blue');



    btnSingleColorMode.classList.add('gray');



    // Keep color selector panel always visible







    isRainbowFixedMode = false;



    isMaterialChangingMode = false;







    btnNormalMode.classList.remove('blue');



    btnNormalMode.classList.add('gray');







    btnColorMode.classList.remove('blue');



    btnColorMode.classList.add('gray');







    btnRainbowFixedMode.classList.remove('blue');



    btnRainbowFixedMode.classList.add('gray');







    btnMaterialMode.classList.remove('blue');



    btnMaterialMode.classList.add('gray');







    btnRainbowMode.classList.remove('gray');



    btnRainbowMode.classList.add('blue');







    // Make sure we have original texture aliases



    await restoreDefaultTextures();







    // 绔嬪埢鎸夋瘡3琛屼竴涓鑹茬粰鎵€鏈夋柟鍧椾笂鑹诧紙浠庢渶椤堕儴鏈夋柟鍧楃殑琛屽紑濮嬶級



    const minRow = blocks.reduce((m, b) => Math.min(m, b.row), Infinity);



    blocks.forEach(b => { if (b.isCollectible || b.isProp) return;



      const color = RAINBOW_PALETTE[Math.floor((b.row - minRow) / 3) % RAINBOW_PALETTE.length];



      b.color = color;



      const tex = PIXI.Assets.get(`${color}-${b.length}`);



      if (tex) b.sprite.texture = tex;



    });



    syncModeButtonsUI();



  };







  btnRainbowFixedMode.onclick = async () => {



    deactivateCollectMode();



    if (isRainbowFixedMode) return;







    isRainbowFixedMode = true;



    isRainbowMode = false;



    isColorChangingMode = false;



    isSingleColorMode = false;



    isCustomTwoColorMode = false;



    btnColorMode.innerHTML = '<span class="icon">🎨</span>变色模式';



    btnSingleColorMode.innerHTML = '<span class="icon">🎨</span>单色变色';



    btnCustomTwoColorMode.classList.remove('blue');



    btnCustomTwoColorMode.classList.add('gray');



    btnSingleColorMode.classList.remove('blue');



    btnSingleColorMode.classList.add('gray');



    // Keep color selector panel always visible







    isMaterialChangingMode = false;







    btnNormalMode.classList.remove('blue');



    btnNormalMode.classList.add('gray');







    btnColorMode.classList.remove('blue');



    btnColorMode.classList.add('gray');







    btnRainbowMode.classList.remove('blue');



    btnRainbowMode.classList.add('gray');







    btnMaterialMode.classList.remove('blue');



    btnMaterialMode.classList.add('gray');







    btnRainbowFixedMode.classList.remove('gray');



    btnRainbowFixedMode.classList.add('blue');







    // Make sure we have original texture aliases



    await restoreDefaultTextures();



    resetAndApplyActiveModeStyle();



    syncModeButtonsUI();



  };







  btnMaterialMode.onclick = async () => {



    deactivateCollectMode();



    if (isMaterialChangingMode) return;







    isMaterialChangingMode = true;



    isColorChangingMode = false;



    isSingleColorMode = false;



    isCustomTwoColorMode = false;



    btnColorMode.innerHTML = '<span class="icon">🎨</span>变色模式';



    btnSingleColorMode.innerHTML = '<span class="icon">🎨</span>单色变色';



    btnCustomTwoColorMode.classList.remove('blue');



    btnCustomTwoColorMode.classList.add('gray');



    btnSingleColorMode.classList.remove('blue');



    btnSingleColorMode.classList.add('gray');



    // Keep color selector panel always visible







    isRainbowMode = false;



    isRainbowFixedMode = false;







    btnNormalMode.classList.remove('blue');



    btnNormalMode.classList.add('gray');







    btnColorMode.classList.remove('blue');



    btnColorMode.classList.add('gray');







    btnRainbowMode.classList.remove('blue');



    btnRainbowMode.classList.add('gray');







    btnRainbowFixedMode.classList.remove('blue');



    btnRainbowFixedMode.classList.add('gray');







    btnMaterialMode.classList.remove('gray');



    btnMaterialMode.classList.add('blue');







    // Make sure all materials are preloaded



    await preloadAllMaterials();







    // Start with the first material pack immediately if available



    activeMaterialIndex = 0;



    changeMaterialsInOrder();



    syncModeButtonsUI();



  };







  btnSingleColorMode.onclick = async () => {



    if (isSingleColorMode) {



      changeSingleColor();



    } else {



      deactivateCollectMode();



      isSingleColorMode = true;



      isColorChangingMode = false;



      btnColorMode.innerHTML = '<span class="icon">🎨</span>变色模式';



      isCustomTwoColorMode = false;



      btnCustomTwoColorMode.classList.remove('blue');



      btnCustomTwoColorMode.classList.add('gray');



      isRainbowMode = false;



      isRainbowFixedMode = false;



      isMaterialChangingMode = false;







      btnNormalMode.classList.remove('blue');



      btnNormalMode.classList.add('gray');







      btnColorMode.classList.remove('blue');



      btnColorMode.classList.add('gray');







      btnRainbowMode.classList.remove('blue');



      btnRainbowMode.classList.add('gray');







      btnRainbowFixedMode.classList.remove('blue');



      btnRainbowFixedMode.classList.add('gray');







      btnMaterialMode.classList.remove('blue');



      btnMaterialMode.classList.add('gray');







      btnSingleColorMode.classList.remove('gray');



      btnSingleColorMode.classList.add('blue');







      await restoreDefaultTextures();



      singleColorIndex = 0;



    }







    const color = SINGLE_COLORS[singleColorIndex];



    btnSingleColorMode.innerHTML = `<span class="icon">🎨</span>单色: ${getColorLabel(color)}`;







    blocks.forEach(b => {



      if (b.isCollectible || b.isProp) return;



      b.color = color;



      const texture = PIXI.Assets.get(`${color}-${b.length}`);



      if (texture) {



        b.sprite.texture = texture;



      }



    });



    syncModeButtonsUI();



  };







  btnNoGravityMode.onclick = () => {



    setGravityMode(!isNoGravityMode);



  };







  btnCollectMode.onclick = async () => {



    if (isCollectMode) return;







    isCollectMode = true;



    isColorChangingMode = false;



    isSingleColorMode = false;



    isCustomTwoColorMode = false;



    isRainbowMode = false;



    isRainbowFixedMode = false;



    isMaterialChangingMode = false;







    // Reset other buttons



    btnColorMode.innerHTML = '<span class="icon">🎨</span>变色模式';



    btnSingleColorMode.innerHTML = '<span class="icon">🎨</span>单色变色';



    btnCustomTwoColorMode.classList.remove('blue');



    btnCustomTwoColorMode.classList.add('gray');



    btnSingleColorMode.classList.remove('blue');



    btnSingleColorMode.classList.add('gray');



    btnNormalMode.classList.remove('blue');



    btnNormalMode.classList.add('gray');



    btnColorMode.classList.remove('blue');



    btnColorMode.classList.add('gray');



    btnRainbowMode.classList.remove('blue');



    btnRainbowMode.classList.add('gray');



    btnRainbowFixedMode.classList.remove('blue');



    btnRainbowFixedMode.classList.add('gray');



    btnMaterialMode.classList.remove('blue');



    btnMaterialMode.classList.add('gray');







    btnCollectMode.classList.remove('gray');



    btnCollectMode.classList.add('blue');







    collectedCount = 0;



    await updateActiveCollectible();







    // Convert some existing 1x1 blocks on the board to collectibles



    const blocksToConvert = blocks.filter(b => b.length === 1 && Math.random() < 0.3);



    blocksToConvert.forEach(b => {



      const col = b.col;



      const row = b.row;



      const length = b.length;



      const color = b.color;



      const id = b.id;



      const noGravity = b.noGravity;







      blocksContainer.removeChild(b.sprite);



      b.sprite.destroy();



      blocks = blocks.filter(item => item.id !== id);







      spawnBlock(col, row, length, color, id, noGravity, true);



    });







    captureBoardState();



    updateHeaderUI();



    syncModeButtonsUI();



  };











  // Effect Type Cards Click



  const effectCards = document.querySelectorAll('.effect-card');



  effectCards.forEach(card => {



    (card as HTMLElement).onclick = () => {



      const type = card.getAttribute('data-type') || 'default';



      PARAMS.effectType = type;



      syncEffectTypeUI();



    };



  });



  syncEffectTypeUI();







  const handleResize = () => {



    const sp = parseInt((document.getElementById('input-speed') as HTMLInputElement).value) || PARAMS.scrollSpeed;



    PARAMS.scrollSpeed = sp;



  };







  document.getElementById('input-speed')!.oninput = handleResize;







  const scriptSpeedInput = document.getElementById('input-script-scroll-speed') as HTMLInputElement;



  const mainSpeedInput = document.getElementById('input-speed') as HTMLInputElement;



  if (scriptSpeedInput && mainSpeedInput) {



    scriptSpeedInput.oninput = () => {



      const v = parseInt(scriptSpeedInput.value) || 0;



      PARAMS.scrollSpeed = v;



      mainSpeedInput.value = v.toString();



    };



    const originalSpeedOnInput = mainSpeedInput.oninput;



    mainSpeedInput.oninput = (e) => {



      if (originalSpeedOnInput) originalSpeedOnInput.call(mainSpeedInput, e);



      scriptSpeedInput.value = mainSpeedInput.value;



    };



  }







  [1, 2, 3, 4].forEach(i => {



    const input = document.getElementById(`prob-${i}`) as HTMLInputElement;



    const valSpan = document.getElementById(`val-${i}`)!;



    input.oninput = (e) => {



      const v = parseInt((e.target as HTMLInputElement).value);



      PROBS[i as keyof typeof PROBS] = v;



      valSpan.innerText = v.toString();



    };



  });







  // Save / Load functionality



  const btnSave = document.getElementById('btn-save-slot')!;



  const btnLoad = document.getElementById('btn-load-slot')!;



  const btnDelete = document.getElementById('btn-delete-slot')!;



  const slotSelect = document.getElementById('save-slot') as HTMLSelectElement;



  const inputSaveName = document.getElementById('input-save-name') as HTMLInputElement;







  function refreshSaveList() {



    const savedNames = readSaveNameList('blockPuzzleSaveNames', 'blockPuzzleSave_');



    slotSelect.innerHTML = '<option value="">-- 选择已有存档 --</option>';



    savedNames.forEach(name => {



      const opt = document.createElement('option');



      opt.value = name;



      opt.innerText = name;



      slotSelect.appendChild(opt);



    });



  }



  refreshSaveList();







  btnSave.onclick = () => {



    let name = inputSaveName.value.trim();



    if (!name) name = `排面_${new Date().toLocaleTimeString()}`;



    const savedLayoutMask = normalizeBooleanMask(layoutDrawMask);



    const savedBoardHoleMask = normalizeBooleanMask(holeMask);



    const saveData = {



      schemaVersion: NORMAL_LAYOUT_SAVE_VERSION,



      params: { ...PARAMS },



      probs: { ...PROBS },



      // Keep the legacy field as the layout mask so exports remain readable by older builds.



      holeMask: savedLayoutMask,



      layoutDrawMask: savedLayoutMask,



      boardHoleMask: savedBoardHoleMask,



      isFixedBoardMode: isFixedBoardMode,



      isFallingMode,



      boardMechanic: getActiveBoardMechanic(),



      boardAdvanceMode



    };



    localStorage.setItem(`blockPuzzleSave_${name}`, JSON.stringify(saveData));







    const savedNames = readSaveNameList('blockPuzzleSaveNames', 'blockPuzzleSave_');



    if (!savedNames.includes(name)) {



      savedNames.push(name);



      localStorage.setItem('blockPuzzleSaveNames', JSON.stringify(savedNames));



    }







    refreshSaveList();



    slotSelect.value = name;



    alert(`已保存排面：${name}`);



  };







  btnLoad.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    try {



      const name = slotSelect.value;



      if (!name) return alert('请先选择一个存档！');



      const saveData = loadJsonFromStorage<any>(`blockPuzzleSave_${name}`, `存档?{name}`);



      if (!saveData) return;







      const hasSplitMasks = saveData.schemaVersion >= NORMAL_LAYOUT_SAVE_VERSION



        || Array.isArray(saveData.layoutDrawMask)



        || Array.isArray(saveData.boardHoleMask);



      // In every pre-v2 normal save, holeMask meant the hand-drawn layout gaps.



      const savedLayoutMask = hasSplitMasks



        ? (saveData.layoutDrawMask ?? saveData.holeMask)



        : saveData.holeMask;



      const savedBoardHoleMask = hasSplitMasks ? saveData.boardHoleMask : undefined;







      Object.assign(PARAMS, normalizeSavedParams(saveData.params));



      PARAMS.shatterMode = PARAMS.shatterMode || 1;



      if (saveData.probs && typeof saveData.probs === 'object') Object.assign(PROBS, saveData.probs);



      syncAllInputsFromParams();







      setBoardMechanic(normalizeBoardMechanic(saveData), false);



      if (!isFallingMode) applyBoardAdvanceMode(boardAdvanceMode);



      syncModeButtonsUI();







      [1, 2, 3, 4].forEach(i => {



        const v = PROBS[i as keyof typeof PROBS];



        (document.getElementById(`prob-${i}`) as HTMLInputElement).value = v.toString();



        document.getElementById(`val-${i}`)!.innerText = v.toString();



      });







      clearAllBlocks();



      currentMode = 'draw';



      applyGridConfig();







      holeMask = normalizeBooleanMask(savedBoardHoleMask);



      layoutDrawMask = normalizeBooleanMask(savedLayoutMask);



      bottomMenu.classList.add('hidden');



      manualMenu.classList.add('hidden');



      boardEditorMenu.classList.add('hidden');



      drawMenu.classList.remove('hidden');



      drawHoles();



      setWorldY(0);



      positionPreviewCanvasInMaster();



      alert(`成功读取存档?{name}`);



    } catch (err) {



      console.error('Load layout failed:', err);



      alert('读取存档失败，已在控制台记录错误');



    }



  };







  btnDelete.onclick = () => {



    const name = slotSelect.value;



    if (!name) return alert('请先选择一个存档！');



    if (!confirm(`纭畾瑕佸垹闄ゅ瓨妗?"${name}" 鍚楋紵`)) return;







    localStorage.removeItem(`blockPuzzleSave_${name}`);



    let savedNames = readSaveNameList('blockPuzzleSaveNames', 'blockPuzzleSave_');



    savedNames = savedNames.filter(n => n !== name);



    localStorage.setItem('blockPuzzleSaveNames', JSON.stringify(savedNames));







    refreshSaveList();



    alert(`已删除存档：${name}`);



  };







  // Export to local file



  const btnExportLayout = document.getElementById('btn-export-layout')!;



  btnExportLayout.onclick = () => {



    const name = slotSelect.value;



    if (!name) return alert('请先选择一个已有存档再导出');



    const dataStr = localStorage.getItem(`blockPuzzleSave_${name}`);



    if (!dataStr) return alert('找不到该存档的数据！');







    const blob = new Blob([dataStr], { type: 'application/json' });



    const url = URL.createObjectURL(blob);



    const a = document.createElement('a');



    a.href = url;



    a.download = `${name}.json`;



    a.click();



    URL.revokeObjectURL(url);



  };







  // Import from local file



  const btnImportLayout = document.getElementById('btn-import-layout')!;



  btnImportLayout.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    const fileInput = document.createElement('input');



    fileInput.type = 'file';



    fileInput.accept = '.json';



    fileInput.onchange = (e) => {



      const file = (e.target as HTMLInputElement).files?.[0];



      if (!file) return;







      const reader = new FileReader();



      reader.onload = (event) => {



        try {



          const importData = JSON.parse(event.target?.result as string);



          if (!importData.params || !importData.probs || !importData.holeMask) {



            return alert('无效的存档文件格式！');



          }







          let importName = file.name.replace(/\.json$/i, '');



          localStorage.setItem(`blockPuzzleSave_${importName}`, JSON.stringify(importData));







          const savedNames = readSaveNameList('blockPuzzleSaveNames', 'blockPuzzleSave_');



          if (!savedNames.includes(importName)) {



            savedNames.push(importName);



            localStorage.setItem('blockPuzzleSaveNames', JSON.stringify(savedNames));



          }







          refreshSaveList();



          slotSelect.value = importName;



          btnLoad.click();



          alert(`成功导入并读取存档：${importName}`);



        } catch (err) {



          console.error(err);



          alert('解析存档文件失败，请检查文件内容！');



        }



      };



      reader.readAsText(file);



    };



    fileInput.click();



  };







  // Fixed Layout Save / Load functionality



  const btnFixedSave = document.getElementById('btn-fixed-save-slot')!;



  const btnFixedLoad = document.getElementById('btn-fixed-load-slot')!;



  const btnFixedDelete = document.getElementById('btn-fixed-delete-slot')!;



  const fixedSlotSelect = document.getElementById('fixed-save-slot') as HTMLSelectElement;



  const inputFixedSaveName = document.getElementById('input-fixed-save-name') as HTMLInputElement;







  function refreshFixedSaveList() {



    const savedNames = readSaveNameList('blockPuzzleFixedSaveNames', 'blockPuzzleFixedSave_');



    fixedSlotSelect.innerHTML = '<option value="">-- 选择已有存档 --</option>';



    savedNames.forEach(name => {



      const opt = document.createElement('option');



      opt.value = name;



      opt.innerText = name;



      fixedSlotSelect.appendChild(opt);



    });



  }



  refreshFixedSaveList();







  btnFixedSave.onclick = () => {



    let name = inputFixedSaveName.value.trim();



    if (!name) name = `固定排面_${new Date().toLocaleTimeString()}`;



    



    const savedBlocks = blocks.map(b => ({



      col: b.col,



      row: b.row,



      length: b.length,



      color: b.color,



      noGravity: b.noGravity,



      isCollectible: b.isCollectible,



      isProp: b.isProp,



      propType: b.propType,

        propDir: b.propDir



    }));







    const saveData = {



      params: PARAMS,



      blocks: savedBlocks,



      isFixedBoardMode: isFixedBoardMode,



      isFallingMode: isFallingMode,



      boardMechanic: getActiveBoardMechanic(),



      boardAdvanceMode



    };



    localStorage.setItem(`blockPuzzleFixedSave_${name}`, JSON.stringify(saveData));







    const savedNames = readSaveNameList('blockPuzzleFixedSaveNames', 'blockPuzzleFixedSave_');



    if (!savedNames.includes(name)) {



      savedNames.push(name);



      localStorage.setItem('blockPuzzleFixedSaveNames', JSON.stringify(savedNames));



    }







    refreshFixedSaveList();



    fixedSlotSelect.value = name;



    inputFixedSaveName.value = '';



    alert(`已保存固定排面：${name}`);



  };







  btnFixedLoad.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    try {



      const name = fixedSlotSelect.value;



      if (!name) return alert('请先选择一个固定排面存档！');



      const saveData = loadJsonFromStorage<any>(`blockPuzzleFixedSave_${name}`, `固定排面存档?{name}`);



      if (!saveData) return;







      Object.assign(PARAMS, normalizeSavedParams(saveData.params));



      syncAllInputsFromParams();







      setBoardMechanic(normalizeBoardMechanic(saveData), false);



      if (!isFallingMode) applyBoardAdvanceMode(boardAdvanceMode);



      syncModeButtonsUI();







      clearAllBlocks();



      applyGridConfig();







      // Reset layout mode to play



      currentMode = 'play';



      const bottomMenu = document.getElementById('bottom-menu')!;



      const drawMenu = document.getElementById('draw-menu')!;



      drawMenu.classList.add('hidden');



      bottomMenu.classList.remove('hidden');



      holeGraphics.clear();



      document.getElementById('game-over-text')!.style.display = 'none';







      // Spawn saved blocks



      const savedBlocks = Array.isArray(saveData.blocks) ? saveData.blocks : [];



      savedBlocks.forEach((sb: any) => {



        const col = Number(sb.col) || 0;



        const row = Number(sb.row) || 0;



        const length = Math.max(1, Math.min(4, Number(sb.length) || 1));



        const color = typeof sb.color === 'string' ? sb.color : 'red';



        spawnBlock(sb.col, sb.row, sb.length, sb.color, sb.id, sb.noGravity, sb.isCollectible, sb.isProp, sb.propType, sb.propDir || 'left');



      });







      if (isNoGravityMode) {



        const hasAnyNoGravity = blocks.some(b => b.noGravity);



        if (!hasAnyNoGravity) {



          detectFloatingBlocks();



        }



      }







      preventFullRows();



      runPhysicsInstant();



      setWorldY(0);



      resetAndApplyActiveModeStyle();



      captureBoardState();



      positionPreviewCanvasInMaster();



      



      alert(`成功读取固定排面存档?{name}`);



    } catch (err) {



      console.error('Load fixed layout failed:', err);



      alert('读取固定排面失败，已在控制台记录错误');



    }



  };







  btnFixedDelete.onclick = () => {



    const name = fixedSlotSelect.value;



    if (!name) return alert('请先选择一个固定排面存档！');



    if (!confirm(`纭畾瑕佸垹闄ゅ浐瀹氬瓨妗?"${name}" 鍚楋紵`)) return;







    localStorage.removeItem(`blockPuzzleFixedSave_${name}`);



    let savedNames = readSaveNameList('blockPuzzleFixedSaveNames', 'blockPuzzleFixedSave_');



    savedNames = savedNames.filter(n => n !== name);



    localStorage.setItem('blockPuzzleFixedSaveNames', JSON.stringify(savedNames));







    refreshFixedSaveList();



    alert(`已删除固定存档：${name}`);



  };







  // Fixed Export to local file



  const btnFixedExportLayout = document.getElementById('btn-fixed-export-layout')!;



  btnFixedExportLayout.onclick = () => {



    const name = fixedSlotSelect.value;



    if (!name) return alert('请先选择一个已有固定排面存档再导出');



    const dataStr = localStorage.getItem(`blockPuzzleFixedSave_${name}`);



    if (!dataStr) return alert('找不到该存档的数据！');







    const blob = new Blob([dataStr], { type: 'application/json' });



    const url = URL.createObjectURL(blob);



    const a = document.createElement('a');



    a.href = url;



    a.download = `${name}_fixed.json`;



    a.click();



    URL.revokeObjectURL(url);



  };







  // Fixed Import from local file



  const btnFixedImportLayout = document.getElementById('btn-fixed-import-layout')!;



  btnFixedImportLayout.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    const fileInput = document.createElement('input');



    fileInput.type = 'file';



    fileInput.accept = '.json';



    fileInput.onchange = (e) => {



      const file = (e.target as HTMLInputElement).files?.[0];



      if (!file) return;







      const reader = new FileReader();



      reader.onload = (event) => {



        try {



          const importData = JSON.parse(event.target?.result as string);



          if (!importData.params || !importData.blocks) {



            return alert('无效的固定排面存档文件格式！');



          }







          let importName = file.name.replace(/\.json$/i, '').replace(/_fixed$/i, '');



          localStorage.setItem(`blockPuzzleFixedSave_${importName}`, JSON.stringify(importData));







          const savedNames = readSaveNameList('blockPuzzleFixedSaveNames', 'blockPuzzleFixedSave_');



          if (!savedNames.includes(importName)) {



            savedNames.push(importName);



            localStorage.setItem('blockPuzzleFixedSaveNames', JSON.stringify(savedNames));



          }







          refreshFixedSaveList();



          fixedSlotSelect.value = importName;



          btnFixedLoad.click();



          alert(`成功导入并读取固定排面：${importName}`);



        } catch (err) {



          console.error(err);



          alert('解析固定排面文件失败，请检查文件内容！');



        }



      };



      reader.readAsText(file);



    };



    fileInput.click();



  };







  // Demo Script Save / Load functionality



  const btnScriptSave = document.getElementById('btn-script-save')!;



  const btnScriptLoad = document.getElementById('btn-script-load')!;



  const btnScriptDelete = document.getElementById('btn-script-delete')!;



  const scriptSaveSlotSelect = document.getElementById('select-script-save-slot') as HTMLSelectElement;



  const inputScriptSaveName = document.getElementById('input-script-save-name') as HTMLInputElement;







  function refreshScriptSaveList() {



    const savedNames = readSaveNameList('blockPuzzleDemoScriptNames', 'blockPuzzleDemoScript_');



    scriptSaveSlotSelect.innerHTML = '<option value="">-- 选择已有剧本 --</option>';



    savedNames.forEach(name => {



      const opt = document.createElement('option');



      opt.value = name;



      opt.innerText = name;



      scriptSaveSlotSelect.appendChild(opt);



    });



  }



  refreshScriptSaveList();







  btnScriptSave.onclick = () => {



    let name = inputScriptSaveName.value.trim();



    if (!name) name = `剧本_${new Date().toLocaleTimeString()}`;



    



    const savedBlocks = initialBoardBlocks.length > 0 ? initialBoardBlocks : blocks.map(b => ({



      id: b.id,



      col: b.col,



      row: b.row,



      length: b.length,



      color: b.color,



      noGravity: b.noGravity,



      isCollectible: b.isCollectible,



      isProp: b.isProp,



      propType: b.propType,

        propDir: b.propDir



    }));



    const saveData = {



      params: PARAMS,



      initialBlocks: savedBlocks,



      initialScrollY: initialScrollY,



      initialScrollRow: initialScrollRow,



      scriptSteps: scriptSteps,



      holeMask: holeMask,



      modes: {



        isCollectMode,



        isColorChangingMode,



        isSingleColorMode,



        isCustomTwoColorMode,



        isRainbowMode,



        isRainbowFixedMode,



        isMaterialChangingMode,



        isNoGravityMode,



        isFixedBoardMode,



        isFallingMode,



        boardMechanic: getActiveBoardMechanic(),



        boardAdvanceMode,



        isRisingMode: boardAdvanceMode === 'rising',



        collectedCount



      }



    };



    



    localStorage.setItem(`blockPuzzleDemoScript_${name}`, JSON.stringify(saveData));







    const savedNames = readSaveNameList('blockPuzzleDemoScriptNames', 'blockPuzzleDemoScript_');



    if (!savedNames.includes(name)) {



      savedNames.push(name);



      localStorage.setItem('blockPuzzleDemoScriptNames', JSON.stringify(savedNames));



    }







    refreshScriptSaveList();



    scriptSaveSlotSelect.value = name;



    inputScriptSaveName.value = '';



    alert(`成功保存演示剧本?{name}`);



  };







  btnScriptLoad.onclick = async () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    try {



      const name = scriptSaveSlotSelect.value;



      if (!name) return alert('请先选择一个已有剧本！');



      const saveData = loadJsonFromStorage<any>(`blockPuzzleDemoScript_${name}`, `剧本?{name}`);



      if (!saveData) return;







      const savedCellSize = Number(saveData.params?.cellSize) || PARAMS.cellSize;



      Object.assign(PARAMS, normalizeSavedParams(saveData.params));



      syncAllInputsFromParams();







      // Restore modes



      const modes = saveData.modes || {};



      isColorChangingMode = !!modes.isColorChangingMode;



      isSingleColorMode = !!modes.isSingleColorMode;



      isCustomTwoColorMode = !!modes.isCustomTwoColorMode;



      isRainbowMode = !!modes.isRainbowMode;



      isRainbowFixedMode = !!modes.isRainbowFixedMode;



      isMaterialChangingMode = !!modes.isMaterialChangingMode;



      isNoGravityMode = !!modes.isNoGravityMode;



      setBoardMechanic(normalizeBoardMechanic(modes), false);



      if (!isFallingMode) applyBoardAdvanceMode(boardAdvanceMode);



      



      isCollectMode = !!modes.isCollectMode;



      collectedCount = modes.collectedCount || 0;







      syncModeButtonsUI();







      if (isCollectMode) {



        await updateActiveCollectible();



      }







      clearAllBlocks();



      applyGridConfig();







      // Restore board shape (hole mask)



      if (Array.isArray(saveData.holeMask)) {



        holeMask = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(false));



        const savedMask = saveData.holeMask;



        for (let r = 0; r < Math.min(PARAMS.totalRows, savedMask.length); r++) {



          if (!Array.isArray(savedMask[r])) continue;



          for (let c = 0; c < Math.min(PARAMS.gridCols, savedMask[r].length); c++) {



            holeMask[r][c] = savedMask[r][c] === true;



          }



        }



      } else {



        holeMask = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(false));



      }



      drawBoardShapeBg();



      drawHoles();







      initialBoardBlocks = Array.isArray(saveData.initialBlocks) ? saveData.initialBlocks : [];



      const hasSavedNoGravityState = initialBoardBlocks.some(sb => sb.noGravity === true);



      initialBoardBlocks.forEach((sb: any) => {



        const col = Number(sb.col) || 0;



        const row = Number(sb.row) || 0;



        const length = Math.max(1, Math.min(4, Number(sb.length) || 1));



        const color = typeof sb.color === 'string' ? sb.color : 'red';



        spawnBlock(sb.col, sb.row, sb.length, sb.color, sb.id, sb.noGravity, sb.isCollectible, sb.isProp, sb.propType, sb.propDir || 'left');



      });







      // Older scripts did not persist no-gravity flags. Reconstruct them once



      // from the saved starting layout before capturing the upgraded snapshot.



      if (isNoGravityMode && !hasSavedNoGravityState) {



        detectFloatingBlocks();



      }







      const savedInitialScrollY = saveData.initialScrollY !== undefined ? Number(saveData.initialScrollY) || 0 : 0;



      initialScrollRow = Number.isFinite(saveData.initialScrollRow)



        ? Number(saveData.initialScrollRow)



        : getScrollRowFromWorldY(savedInitialScrollY, savedCellSize);



      initialScrollY = clampWorldY(getWorldYFromScrollRow(initialScrollRow));



      initialScrollRow = getScrollRowFromWorldY(initialScrollY);







      // 涓嶆墽琛岀墿鐞嗭紒杩樺師鍒颁繚瀛樻椂鐨勫師濮嬩綅缃?



      setWorldY(initialScrollY);



      syncModeButtonsUI();







      scriptSteps = Array.isArray(saveData.scriptSteps) ? saveData.scriptSteps : [];



      scriptSteps.forEach(step => {



        if (!Number.isFinite(step.scrollRow)) {



          const legacyScrollY = Number.isFinite(step.scrollY) ? step.scrollY! : savedInitialScrollY;



          step.scrollRow = getScrollRowFromWorldY(legacyScrollY, savedCellSize);



        }



        const clampedStepScrollY = getStepScrollY(step);



        step.scrollRow = getScrollRowFromWorldY(clampedStepScrollY);



        step.scrollY = clampedStepScrollY;



        step.eliminationWaves = normalizeEliminationWaves(step.eliminationWaves);



        step.eliminatedRows = getStepFlatEliminatedRows(step);



      });



      selectedStepIndex = null;







      captureBoardState();



      updateScriptUI();



      positionPreviewCanvasInMaster();







      alert(`成功读取演示剧本?{name}`);



    } catch (err) {



      console.error('Load demo script failed:', err);



      alert('读取演示剧本失败，已在控制台记录错误');



    }



  };







  btnScriptDelete.onclick = () => {



    const name = scriptSaveSlotSelect.value;



    if (!name) return alert('请先选择一个已有剧本！');



    if (!confirm(`Delete demo script "${name}"?`)) return;







    localStorage.removeItem(`blockPuzzleDemoScript_${name}`);



    let savedNames = readSaveNameList('blockPuzzleDemoScriptNames', 'blockPuzzleDemoScript_');



    savedNames = savedNames.filter(n => n !== name);



    localStorage.setItem('blockPuzzleDemoScriptNames', JSON.stringify(savedNames));







    refreshScriptSaveList();



    alert(`已删除演示剧本：${name}`);



  };







  const btnScriptExport = document.getElementById('btn-script-export')!;



  btnScriptExport.onclick = () => {



    const name = scriptSaveSlotSelect.value;



    if (!name) return alert('请先选择一个已有剧本再导出');



    const dataStr = localStorage.getItem(`blockPuzzleDemoScript_${name}`);



    if (!dataStr) return alert('找不到该剧本的数据！');







    const blob = new Blob([dataStr], { type: 'application/json' });



    const url = URL.createObjectURL(blob);



    const a = document.createElement('a');



    a.href = url;



    a.download = `${name}_剧本.json`;



    a.click();



    URL.revokeObjectURL(url);



  };







  const btnScriptImport = document.getElementById('btn-script-import')!;



  btnScriptImport.onclick = () => {



    if (!assetsLoaded) {



      alert('游戏资源正在后台加载，请稍候');



      return;



    }



    const fileInput = document.createElement('input');



    fileInput.type = 'file';



    fileInput.accept = '.json';



    fileInput.onchange = (e) => {



      const file = (e.target as HTMLInputElement).files?.[0];



      if (!file) return;







      const reader = new FileReader();



      reader.onload = (event) => {



        try {



          const importData = JSON.parse(event.target?.result as string);



          if (!importData.params || !importData.initialBlocks || !importData.scriptSteps) {



            return alert('无效的剧本文件格式！');



          }







          let importName = file.name.replace(/_剧本\.json$/i, '').replace(/\.json$/i, '');



          localStorage.setItem(`blockPuzzleDemoScript_${importName}`, JSON.stringify(importData));







          const savedNames = readSaveNameList('blockPuzzleDemoScriptNames', 'blockPuzzleDemoScript_');



          if (!savedNames.includes(importName)) {



            savedNames.push(importName);



            localStorage.setItem('blockPuzzleDemoScriptNames', JSON.stringify(savedNames));



          }







          refreshScriptSaveList();



          scriptSaveSlotSelect.value = importName;



          btnScriptLoad.click();



          alert(`成功导入并读取剧本：${importName}`);



        } catch (err) {



          console.error(err);



          alert('解析剧本文件失败，请检查文件内容！');



        }



      };



      reader.readAsText(file);



    };



    fileInput.click();



  };







  // 监听窗口尺寸变化，自动调整网格大小自适应居中



  window.addEventListener('resize', () => {



    applyGridConfig();



  });







  // 椤甸潰鍒濆鍖栨椂鎵ц涓€娆¤嚜閫傚簲璁＄畻锛堝欢杩熶互纭繚甯冨眬绋冲畾?



  setTimeout(() => {



    applyGridConfig();



  }, 100);



}







let recordingCanvas: HTMLCanvasElement | null = null;



let recordingCtx: CanvasRenderingContext2D | null = null;



let recordingRafId = 0;



let recordingFrameTimerId = 0;



let recordingVideoTrack: (MediaStreamTrack & { requestFrame?: () => void }) | null = null;



let outputCanvas: HTMLCanvasElement | null = null;



let outputCtx: CanvasRenderingContext2D | null = null;



let tempCanvas: HTMLCanvasElement | null = null;



let tempCtx: CanvasRenderingContext2D | null = null;



let boardFadeCanvas: HTMLCanvasElement | null = null;



let boardFadeCtx: CanvasRenderingContext2D | null = null;







// 棰勫垵濮嬪寲褰曞埗鐩稿叧 canvas锛堥〉闈㈠姞杞藉悗绌洪棽鏃舵墽琛岋紝閬垮厤褰曞埗鏃跺喎鍚姩鍗￠】锛?



function prewarmRecordingCanvases() {



  if (!recordingCanvas) {



    recordingCanvas = document.createElement('canvas');



    recordingCtx = recordingCanvas.getContext('2d', { alpha: true });



  }



  if (!outputCanvas) {



    outputCanvas = document.createElement('canvas');



    outputCtx = outputCanvas.getContext('2d', { alpha: false })!;



  }



  if (!tempCanvas) {



    tempCanvas = document.createElement('canvas');



    tempCtx = tempCanvas.getContext('2d', { alpha: true })!;



  }



  if (!boardFadeCanvas) {



    boardFadeCanvas = document.createElement('canvas');



    boardFadeCtx = boardFadeCanvas.getContext('2d', { alpha: true })!;



  }



  // 鍏堢敤灏忓昂瀵搁鐑?GPU 绠＄?



  recordingCanvas.width = 2; recordingCanvas.height = 2;



  outputCanvas.width = 4; outputCanvas.height = 2;



  tempCanvas.width = 2; tempCanvas.height = 2;



  boardFadeCanvas.width = 2; boardFadeCanvas.height = 2;



  recordingCtx!.fillRect(0, 0, 2, 2);



  outputCtx!.fillRect(0, 0, 4, 2);



  outputCtx!.drawImage(recordingCanvas, 0, 0);



  tempCtx!.fillRect(0, 0, 2, 2);



  tempCtx!.drawImage(recordingCanvas, 0, 0);



  boardFadeCtx!.clearRect(0, 0, 2, 2);



}



// 椤甸潰绌洪棽鏃堕鐑?



if (typeof requestIdleCallback !== 'undefined') {



  requestIdleCallback(() => prewarmRecordingCanvases());



} else {



  setTimeout(() => prewarmRecordingCanvases(), 1000);



}







function sanitizeDownloadBaseName(name: string) {



  return name



    .trim()



    .replace(/\.(webm|mp4|mov)$/i, '')



    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')



    .replace(/\s+/g, ' ')



    .replace(/[. ]+$/g, '')



    .slice(0, 120);



}







function getActiveDemoScriptDownloadBaseName() {



  const select = document.getElementById('select-script-save-slot') as HTMLSelectElement | null;



  const value = select?.value ? sanitizeDownloadBaseName(select.value) : '';



  return value || '';



}







function getRecordingDownloadName(defaultStem: string, ext: 'webm' | 'mp4') {



  const scriptBaseName = getActiveDemoScriptDownloadBaseName();



  const baseName = scriptBaseName || `${defaultStem}-${Date.now()}`;



  return `${baseName}.${ext}`;



}







function startRecording(): Promise<boolean> {



  if (isRecording) return Promise.resolve(true);



  isRecordingArmedForPlayback = false;



  prewarmRecordingCanvases(); // 确保已初始化



  const readyPromise = new Promise<boolean>(resolve => {



    recordingReadyResolver = resolve;



  });







  const recordingStartTime = { value: 0 };



  const useRecordingBackground = recordingBackgroundEnabled && !!recordingBackgroundDataUrl;



  const isGreenScreen = !useRecordingBackground && ((document.getElementById('input-greenscreen') as HTMLInputElement)?.checked || false);



  const encoderSettings = getRecordingEncoderSettings(useRecordingBackground);



  if (recordingBackgroundEnabled && recordingBackgroundDataUrl && !recordingBackgroundImage) {



    loadRecordingBackgroundImage(recordingBackgroundDataUrl);



  }







  // onstop 处理函数



  const recorderOnStop = async () => {



    isRecording = false;



    recordingReadyResolver = null;



    gridGraphics.visible = true;



    



    setRecordButtonContent('⏺', '录制', '视频');



    



    const webmBlob = new Blob(recordedChunksWebM, { type: 'video/webm' });



    if (!useRecordingBackground) {



      setRecordButtonContent('⏺', '录制', '视频');



      const url = URL.createObjectURL(webmBlob);



      const a = document.createElement('a');



      a.href = url;



      a.download = getRecordingDownloadName(isGreenScreen ? 'green-screen-source' : 'transparent-source', 'webm');



      a.click();



      URL.revokeObjectURL(url);



      setRecordButtonContent('⏺', '录制', '视频');



      return;



    }







    const durationSeconds = (Date.now() - recordingStartTime.value) / 1000;



    const taskId = crypto.randomUUID?.() || Date.now().toString();



    const convertMode = 'mp4';



    const timeoutMs = Math.max(



      90_000,



      Math.min(10 * 60_000, durationSeconds * 4_500 + 60_000)



    );



    const abortController = new AbortController();



    const timeoutId = window.setTimeout(() => abortController.abort(), timeoutMs);



    const progressTimer = window.setInterval(async () => {



      try {



        const progressResponse = await fetch(`/api/progress?taskId=${encodeURIComponent(taskId)}`, { cache: 'no-store' });



        if (!progressResponse.ok) return;



        const payload = await progressResponse.json();



        const progress = Math.max(0, Math.min(99, Math.round(Number(payload.progress) || 0)));



        if (progress > 0) setRecordButtonContent('⏳', '转码中', progress + '%');



      } catch {



        // Progress is only a hint; the main conversion request controls success/failure.



      }



    }, 1000);



    



    try {



        const response = await fetch(`/api/convert?taskId=${encodeURIComponent(taskId)}&duration=${durationSeconds}&mode=${convertMode}&fps=${encoderSettings.fps}`, {



            method: 'POST',



            body: webmBlob,



            signal: abortController.signal



        });



        



        const contentType = response.headers.get('content-type') || '';



        const expectedType = 'video/mp4';



        if (response.ok && contentType.includes(expectedType)) {



            const convertedBlob = await response.blob();



            const url = URL.createObjectURL(convertedBlob);



            const a = document.createElement('a');



            a.href = url;



            a.download = getRecordingDownloadName('direct-output', 'mp4');



            a.click();



            URL.revokeObjectURL(url);



        } else {



            throw new Error(`Unexpected conversion response: status=${response.status}, content-type=${contentType || 'empty'}`);



        }



    } catch (err) {



        console.error('Server conversion failed or unavailable, downloading source WebM:', err);



        



        const url = URL.createObjectURL(webmBlob);



        const a = document.createElement('a');



        a.href = url;



        a.download = getRecordingDownloadName('direct-output', 'webm');



        a.click();



        URL.revokeObjectURL(url);



    } finally {



        window.clearInterval(progressTimer);



        window.clearTimeout(timeoutId);



        setRecordButtonContent('⏺', '录制', '视频');



    }



  };







  // 闅愯棌搴曢儴鐨勭綉鏍?



  gridGraphics.visible = false;







  const headerEl = document.getElementById('game-header')!;



  const headerHeight = headerEl.offsetHeight || 50; 



  const pixiCanvas = app.canvas as HTMLCanvasElement;



  const dpr = window.devicePixelRatio || 1;



  



  const isHideText = (document.getElementById('input-hidetext') as HTMLInputElement)?.checked || false;



  const currentOffset = useRecordingBackground || isHideText ? 0 : (headerHeight + 30) * dpr;







  const width = useRecordingBackground ? MASTER_UI.width : pixiCanvas.width;



  const height = useRecordingBackground ? MASTER_UI.height : pixiCanvas.height + currentOffset;







  // 浠呭湪灏哄鍙樺寲鏃舵墠 resize锛堥伩鍏?GPU 閲嶆柊鍒嗛厤?



  if (recordingCanvas!.width !== width || recordingCanvas!.height !== height) {



    recordingCanvas!.width = width;



    recordingCanvas!.height = height;



  }



  const outputWidth = useRecordingBackground ? width : width * 2;



  if (outputCanvas!.width !== outputWidth || outputCanvas!.height !== height) {



    outputCanvas!.width = outputWidth;



    outputCanvas!.height = height;



  }



  if (tempCanvas!.width !== width || tempCanvas!.height !== height) {



    tempCanvas!.width = width;



    tempCanvas!.height = height;



  }







  const frameIntervalMs = 1000 / encoderSettings.fps;



  let nextRecordingFrameAt = performance.now();



  const scheduleNextRecordingFrame = () => {



    if (!isRecording) return;



    const delay = Math.max(0, nextRecordingFrameAt - performance.now());



    recordingFrameTimerId = window.setTimeout(() => {



      recordingRafId = requestAnimationFrame(drawFrame);



    }, delay);



  };







  const drawFrame = () => {



    if (!isRecording) return;



    



    const boardWrapper = document.getElementById('board-wrapper');



    



    // 1. 姝ｅ父缁樺埗甯﹂€忔槑閫氶亾鐨勭敾闈㈠埌 recordingCtx



    if (useRecordingBackground) {



      drawRecordingBackground(recordingCtx!, width, height);



    } else if (isGreenScreen) {



      recordingCtx!.fillStyle = '#00ff00';



      recordingCtx!.fillRect(0, 0, width, height);



    } else {



      recordingCtx!.clearRect(0, 0, width, height);



    }



    



    if (!isHideText) {



      // 鍥為€€鍒版祻瑙堝櫒鏀寔鐨勬渶澶у悎娉曞瓧?900 (Canvas 浼氬洜涓?1000 鎶ラ敊鑰屽鑷存暣琛屽け鏁堬紝閫€鍥為粯璁ょ粏浣?



      const headerBox = useRecordingBackground



        ? {



            x: MASTER_UI.header.x * width,



            y: MASTER_UI.header.y * height,



            w: MASTER_UI.header.w * width,



            h: MASTER_UI.header.h * height



          }



        : { x: 0, y: 0, w: width, h: headerHeight * dpr };



      const headerItems = Array.from(document.querySelectorAll<HTMLElement>('#game-header .header-item'));



      const boardRectForHeader = boardWrapper?.getBoundingClientRect();



      const headerFontSize = useRecordingBackground && headerItems[0] && boardRectForHeader



        ? parseFloat(getComputedStyle(headerItems[0]).fontSize) * (width / boardRectForHeader.width)



        : 26 * dpr;



      recordingCtx!.font = `700 ${headerFontSize}px 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif`;



      recordingCtx!.fillStyle = '#ffffff';



      recordingCtx!.strokeStyle = '#ffffff';



      // 用描边来物理实现字重调整效果



      recordingCtx!.lineWidth = useRecordingBackground ? 0 : 1.25 * dpr;



      recordingCtx!.textBaseline = 'middle';



      recordingCtx!.shadowBlur = 0; // 关闭阴影防止异常







      if ('letterSpacing' in recordingCtx!) {



          (recordingCtx as any).letterSpacing = `${useRecordingBackground ? 0 : 2 * dpr}px`;



      }



      



      // 纵向拉伸文字



      recordingCtx!.save();



      if (!useRecordingBackground) recordingCtx!.scale(1, 1.3);



      const firstHeaderRect = headerItems[0]?.getBoundingClientRect();



      const textY = useRecordingBackground && firstHeaderRect && boardRectForHeader



        ? ((firstHeaderRect.top + firstHeaderRect.height / 2) - boardRectForHeader.top) * (height / boardRectForHeader.height)



        : (headerBox.y + headerBox.h / 2) / 1.3;







      const leftText = `LEVEL: ${document.getElementById('level-val')!.innerText}`;



      recordingCtx!.textAlign = 'left';



      const leftRect = headerItems[0]?.getBoundingClientRect();



      const leftX = useRecordingBackground && leftRect && boardRectForHeader



        ? (leftRect.left - boardRectForHeader.left) * (width / boardRectForHeader.width)



        : headerBox.x + headerBox.w * 0.05;



      recordingCtx!.fillText(leftText, leftX, textY);



      if (!useRecordingBackground) recordingCtx!.strokeText(leftText, leftX, textY);



      



      if (!isCollectMode) {



        recordingCtx!.textAlign = 'right';



        const rightText = `SCORE: ${document.getElementById('score-val')!.innerText}`;



        const rightRect = headerItems[1]?.getBoundingClientRect();



        const rightX = useRecordingBackground && rightRect && boardRectForHeader



          ? (rightRect.right - boardRectForHeader.left) * (width / boardRectForHeader.width)



          : headerBox.x + headerBox.w * 0.95;



        recordingCtx!.fillText(rightText, rightX, textY);



        if (!useRecordingBackground) recordingCtx!.strokeText(rightText, rightX, textY);



      }



      recordingCtx!.restore();







      // Draw collectible icon and "x count" text in collect mode



      if (isCollectMode) {



        const collectValEl = document.getElementById('collect-val');



        const countText = collectValEl ? collectValEl.innerText : '0';



        const headerIconEl = document.getElementById('collectible-header-icon') as HTMLImageElement | null;



        



        if (headerIconEl && boardWrapper) {



          const iconRect = headerIconEl.getBoundingClientRect();



          const boardRect = boardWrapper.getBoundingClientRect();



          const rx = (iconRect.left - boardRect.left) * dpr;



          const ry = (iconRect.top - (boardRect.top + (!useRecordingBackground && isHideText ? headerHeight : 0))) * dpr;



          const rw = iconRect.width * dpr;



          const rh = iconRect.height * dpr;



          



          // Draw icon at native aspect ratio (no vertical distortion)



          recordingCtx!.drawImage(headerIconEl, rx, ry, rw, rh);



          



          // Draw "x count" text next to the icon, scaled vertically by 1.3 to match LEVEL style



          recordingCtx!.save();



          recordingCtx!.scale(1, 1.3);



          recordingCtx!.font = `900 ${26 * dpr}px 'Arial Black', 'Impact', sans-serif`;



          recordingCtx!.fillStyle = '#ffffff';



          recordingCtx!.strokeStyle = '#ffffff';



          recordingCtx!.lineWidth = 1.25 * dpr;



          recordingCtx!.textBaseline = 'middle';



          recordingCtx!.textAlign = 'left';



          



          const textX = rx + rw + 8 * dpr;



          const textYCenter = (ry + rh / 2) / 1.3;



          recordingCtx!.fillText(`x ${countText}`, textX, textYCenter);



          recordingCtx!.strokeText(`x ${countText}`, textX, textYCenter);



          recordingCtx!.restore();



        } else {



          // Fallback if elements not ready



          recordingCtx!.save();



          recordingCtx!.scale(1, 1.3);



          recordingCtx!.font = `900 ${26 * dpr}px 'Arial Black', 'Impact', sans-serif`;



          recordingCtx!.fillStyle = '#ffffff';



          recordingCtx!.strokeStyle = '#ffffff';



          recordingCtx!.lineWidth = 1.25 * dpr;



          recordingCtx!.textBaseline = 'middle';



          recordingCtx!.textAlign = 'right';



          const rightText = `COLLECT: ${countText}`;



          recordingCtx!.fillText(rightText, width - 12 * dpr, textY);



          recordingCtx!.strokeText(rightText, width - 12 * dpr, textY);



          recordingCtx!.restore();



        }



      }



    }







    if (useRecordingBackground) {



      const boardClipBox = getMasterBoardContentRect(width, height);



      recordingCtx!.save();



      recordingCtx!.beginPath();



      recordingCtx!.rect(boardClipBox.x, boardClipBox.y, boardClipBox.w, boardClipBox.h);



      recordingCtx!.clip();



      drawRecordingVerticalGrid(recordingCtx!, boardClipBox);



      recordingCtx!.drawImage(



        pixiCanvas,



        0,



        0,



        pixiCanvas.width,



        pixiCanvas.height,



        boardClipBox.x,



        boardClipBox.y,



        boardClipBox.w,



        boardClipBox.h



      );



      recordingCtx!.restore();



    } else {



      recordingCtx!.save();



      recordingCtx!.beginPath();



      recordingCtx!.rect(0, currentOffset, pixiCanvas.width, pixiCanvas.height);



      recordingCtx!.clip();



      recordingCtx!.drawImage(pixiCanvas, 0, currentOffset, pixiCanvas.width, pixiCanvas.height);



      recordingCtx!.restore();



    }



    



    // Draw flying collectibles on top of the recorded frame



    const flyImgs = document.querySelectorAll('.collectible-fly-img');



    if (flyImgs.length > 0 && boardWrapper) {



      const boardRect = boardWrapper.getBoundingClientRect();



        flyImgs.forEach(imgEl => {



          const img = imgEl as HTMLImageElement;



          const flyRect = img.getBoundingClientRect();



          const rx = (flyRect.left - boardRect.left) * dpr;



          const ry = (flyRect.top - (boardRect.top + (!useRecordingBackground && isHideText ? headerHeight : 0))) * dpr;



          const rw = flyRect.width * dpr;



          const rh = flyRect.height * dpr;



          



          recordingCtx!.save();



          recordingCtx!.translate(rx + rw / 2, ry + rh / 2);



          let angle = 0;



          const transform = img.style.transform;



          if (transform && transform.includes('rotate')) {



            const match = transform.match(/rotate\(([-\d.]+)deg\)/);



            if (match) {



              angle = parseFloat(match[1]) * Math.PI / 180;



            }



          }



          recordingCtx!.rotate(angle);



          recordingCtx!.drawImage(img, -rw / 2, -rh / 2, rw, rh);



          recordingCtx!.restore();



        });



      }



    



    const gameOverEl = document.getElementById('game-over-text')!;



    if (gameOverEl.style.display !== 'none') {



       recordingCtx!.font = `900 ${48 * dpr}px sans-serif`;



       recordingCtx!.fillStyle = '#ff3366';



       recordingCtx!.textAlign = 'center';



       recordingCtx!.textBaseline = 'middle';



       recordingCtx!.fillText('GAME OVER', width / 2, height / 2);



    }



    



    if (useRecordingBackground) {



      outputCtx!.fillStyle = '#000000';



      outputCtx!.fillRect(0, 0, width, height);



      outputCtx!.drawImage(recordingCanvas!, 0, 0);



    } else {



      // No-background exports stay as the fast side-by-side source:



      // left = RGB over black, right = alpha mask for post-production.



      outputCtx!.fillStyle = '#000000';



      outputCtx!.fillRect(0, 0, width, height);



      outputCtx!.drawImage(recordingCanvas!, 0, 0);







      tempCtx!.clearRect(0, 0, width, height);



      tempCtx!.drawImage(recordingCanvas!, 0, 0);



      tempCtx!.globalCompositeOperation = 'source-in';



      tempCtx!.fillStyle = '#ffffff';



      tempCtx!.fillRect(0, 0, width, height);



      tempCtx!.globalCompositeOperation = 'source-over';







      outputCtx!.fillStyle = '#000000';



      outputCtx!.fillRect(width, 0, width, height);



      outputCtx!.drawImage(tempCanvas!, width, 0);



    }



    



    recordingVideoTrack?.requestFrame?.();



    nextRecordingFrameAt += frameIntervalMs;



    const now = performance.now();



    if (nextRecordingFrameAt < now - frameIntervalMs) {



      nextRecordingFrameAt = now + frameIntervalMs;



    }



    scheduleNextRecordingFrame();



  };



  



  // ===== 鍒嗛樁娈靛惎?=====



  // ?闃舵锛氱珛鍗冲紑濮嬫覆鏌撳惊鐜?canvas 绠＄?



  isRecording = true;



  setRecordButtonContent('⏳', '准备中', '...');



  drawFrame();







  if (!audioSourcesInitialized) {



    initAudioContext();



  }



  if (audioCtx && audioCtx.state === 'suspended') {



    audioCtx.resume();



  }







  // ?闃舵锛氱瓑 500ms ?canvas 娓叉煋绠＄嚎绋冲畾鍚庯紝鍐嶅惎鍔?MediaRecorder



  setTimeout(() => {



    if (!isRecording) {



      recordingReadyResolver?.(false);



      recordingReadyResolver = null;



      return;



    }







    // Create stream and recorder. Manual requestFrame gives a steadier



    // recording cadence than relying on requestAnimationFrame timing alone.



    let videoStreamMOV = (outputCanvas as any).captureStream(0);



    let videoTrackMOV = videoStreamMOV.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };



    if (typeof videoTrackMOV.requestFrame === 'function') {



      recordingVideoTrack = videoTrackMOV;



    } else {



      videoStreamMOV.getTracks().forEach((track: MediaStreamTrack) => track.stop());



      videoStreamMOV = (outputCanvas as any).captureStream(encoderSettings.fps);



      videoTrackMOV = videoStreamMOV.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };



      recordingVideoTrack = null;



    }



    const tracksMOV: MediaStreamTrack[] = [videoTrackMOV];







    if (recAudioDest) {



      const audioTrack = recAudioDest.stream.getAudioTracks()[0];



      if (audioTrack) {



        tracksMOV.push(audioTrack);



      }



    }







    const streamMOV = new MediaStream(tracksMOV);







    const options: any = {



      mimeType: encoderSettings.mimeType,



      videoBitsPerSecond: encoderSettings.bitrate



    };



    recorderWebM = new MediaRecorder(streamMOV, options);



    recordedChunksWebM = [];



    recorderWebM.ondataavailable = e => { if (e.data.size > 0) recordedChunksWebM.push(e.data); };



    recorderWebM.onstop = recorderOnStop;







    recorderWebM.start();



    recordingStartTime.value = Date.now();



    setRecordButtonContent('⏹', '停止', '录制');



    recordingReadyResolver?.(true);



    recordingReadyResolver = null;



  }, 500);







  return readyPromise;



}







function stopRecording() { 



  if (isRecording) {



    if (recorderWebM && recorderWebM.state !== 'inactive') {



      recorderWebM.stop();



    } else {



      isRecording = false;



      recordingReadyResolver?.(false);



      recordingReadyResolver = null;



      setRecordButtonContent('⏺', '录制', '视频');



    }



    cancelAnimationFrame(recordingRafId);



    window.clearTimeout(recordingFrameTimerId);



    recordingVideoTrack = null;



    gridGraphics.visible = true;



  }



}







(window as any).blocks = blocks;



(window as any).PARAMS = PARAMS;



(window as any).currentMode = currentMode;



(window as any).isNoGravityMode = isNoGravityMode;



(window as any).isCustomTwoColorMode = isCustomTwoColorMode;



(window as any).setWorldY = setWorldY;



(window as any).getBlocksCount = () => blocks.length;



(window as any).getBlocks = () => blocks;



(window as any).getCurrentMode = () => currentMode;



(window as any).getIsNoGravityMode = () => isNoGravityMode;



(window as any).getIsCustomTwoColorMode = () => isCustomTwoColorMode;



(window as any).getRecordingOutputSize = () => {



  const useRecordingBackground = recordingBackgroundEnabled && !!recordingBackgroundDataUrl;



  const headerEl = document.getElementById('game-header');



  const headerHeight = headerEl?.offsetHeight || 50;



  const isHideText = (document.getElementById('input-hidetext') as HTMLInputElement)?.checked || false;



  const dpr = window.devicePixelRatio || 1;



  const transparentHeight = app.canvas.height + (isHideText ? 0 : (headerHeight + 30) * dpr);



  return useRecordingBackground



    ? { width: MASTER_UI.width, height: MASTER_UI.height, mode: 'mp4-background' }



    : { width: app.canvas.width * 2, height: transparentHeight, mode: 'transparent-side-by-side-source' };



};



(window as any).getHoleMask = () => holeMask;



(window as any).getLayoutDrawMask = () => layoutDrawMask;



(window as any).getWorldY = () => worldContainer ? worldContainer.y : 0;



(window as any).getBoardAdvanceMode = () => boardAdvanceMode;



(window as any).getPlayableExportAdvanceMode = () => getActiveBoardAdvanceMode();



(window as any).getBlockOverlaps = () => getBlockOverlapPairs().map(({ first, second }) => ({



  first: { id: first.id, col: first.col, row: first.row, length: first.length },



  second: { id: second.id, col: second.col, row: second.row, length: second.length }



}));



(window as any).getLastShatterCellColors = () => lastShatterCellColors.map(item => ({ ...item }));



(window as any).getLastBorderedGemShatters = () => lastBorderedGemShatters.map(item => ({ ...item }));



loadCustomPropImages();
setTimeout(() => { initPropStylePanel(); }, 600);
(window as any).importPropImage      = (role: 'machine'|'candy') => importPropImage(role);
  (window as any).clearCustomPropImages = clearCustomPropImages;
  (window as any).parseMaterialTextureName = (fileName: string) => parseMaterialTextureName(fileName);



(window as any).getScriptSteps = () => scriptSteps.map(step => ({ ...step }));



(window as any).getSelectedStepIndex = () => selectedStepIndex;



(window as any).getScriptPlaybackState = () => ({



  isPlaying: isPlayingScript,



  stopRequested: scriptPlaybackStopRequested,



  selectedStepIndex,



  activeStepIndex: activeSimulatingStepIndex,



  activeEliminationWaveIndex,



  isAnimating



});



(window as any).getBoardDebugState = () => {



  const occ = getGridOccupancy();



  const fullRows: number[] = [];



  const rowOccupancy: Array<{ row: number; filled: number; cells: number[] }> = [];



  for (let r = 0; r < PARAMS.totalRows; r++) {



    let isFull = true;



    let filled = 0;



    const cells: number[] = [];



    for (let c = 0; c < PARAMS.gridCols; c++) {



      if (occ[r][c] === 0) {



        isFull = false;



      } else {



        filled++;



        cells.push(c);



      }



    }



    if (isFull) fullRows.push(r);



    if (filled > 0) rowOccupancy.push({ row: r, filled, cells });



  }



  const minVisibleRow = Math.max(0, Math.floor(-(worldContainer ? worldContainer.y : 0) / PARAMS.cellSize));



  const visibleBottomRow = getVisibleBottomRowForWorldY(worldContainer ? worldContainer.y : 0);



  return {



    params: { ...PARAMS },



    worldY: worldContainer ? worldContainer.y : 0,



    minVisibleRow,



    visibleBottomRow,



    blockCount: blocks.length,



    fullRows,



    visibleRowOccupancy: rowOccupancy.filter(row => row.row >= minVisibleRow && row.row <= visibleBottomRow),



    bottomRows: rowOccupancy.filter(row => row.row >= Math.max(0, visibleBottomRow - 4) && row.row <= visibleBottomRow + 2),



    scriptSteps: scriptSteps.map(step => ({



      ...step,



      eliminationWaves: normalizeEliminationWaves(step.eliminationWaves),



      eliminatedRows: getStepFlatEliminatedRows(step)



    })),



    selectedStepIndex,



    activeSimulatingStepIndex,



    activeEliminationWaveIndex,



    isPlayingScript,



    isAnimating



  };



};



(window as any).getVocalPackState = () => ({



  activePack: activeVocalPack,



  sources: Object.fromEntries(



    Object.entries(sounds.vocals).map(([key, audio]) => [key, audio.getAttribute('src') || audio.src])



  )



});











// ==========================================



// 🚀 自动演示步骤生成?(Auto Play Generator) 🚀



// ==========================================







interface SimBlock {



  id: number;



  col: number;



  row: number;



  length: number;



  color: string;



  isProp?: boolean;



  propType?: 'row-bomb' | 'peppermint';

  propDir?: 'left' | 'right';



}







interface SimMove {



  blockId: number;



  fromCol: number;



  toCol: number;



  row: number;



  causesElimination: boolean;



  comboCount: number;



  totalCleared: number;



  maxElimRowsInWave: number;



  nextMaxClear?: number;



  dropDistance?: number;



}







function getSimOccupancy(simBlocks: SimBlock[], ignoreId: number = -1): number[][] {



  const grid = Array.from({ length: PARAMS.totalRows }, () => Array(PARAMS.gridCols).fill(0));



  if (holeMask && holeMask.length > 0) {



    for (let r = 0; r < PARAMS.totalRows; r++) {



      if (!holeMask[r]) continue;



      let hasValidCell = false;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (!holeMask[r][c]) { hasValidCell = true; break; }



      }



      if (!hasValidCell) continue;



      for (let c = 0; c < PARAMS.gridCols; c++) {



        if (holeMask[r][c]) grid[r][c] = 1;



      }



    }



  }



  simBlocks.forEach(b => {



    if (b.id === ignoreId) return;



    if (b.row >= 0 && b.row < PARAMS.totalRows) {



      if (b.isProp) {



        getPropOccupiedColumns(b).forEach(col => {



          if (col >= 0 && col < PARAMS.gridCols) grid[b.row][col] = 1;



        });



        return;



      }



      for (let c = 0; c < b.length; c++) {



        const col = b.col + c;



        if (col >= 0 && col < PARAMS.gridCols) {



          grid[b.row][col] = 1;



        }



      }



    }



  });



  return grid;



}







function getSimMoveBounds(simBlocks: SimBlock[], block: SimBlock): { minCol: number; maxCol: number } {



  const rowOcc = getSimOccupancy(simBlocks, block.id)[block.row] || [];



  let minCol = 0;



  let maxCol = PARAMS.gridCols - block.length;



  for (let c = block.col - 1; c >= 0; c--) {



    if (rowOcc[c]) { minCol = c + 1; break; }



  }



  for (let c = block.col + block.length; c < PARAMS.gridCols; c++) {



    if (rowOcc[c]) { maxCol = c - block.length; break; }



  }



  return { minCol, maxCol };



}







function applySimGravity(simBlocks: SimBlock[]) {



  const maxGravityRow = PARAMS.totalRows - 1;



  simBlocks.sort((a, b) => b.row - a.row);



  const simulatedRows: Record<number, number> = {};



  



  simBlocks.forEach(b => {



    let targetRow = b.row;



    while (targetRow < maxGravityRow) {



      let canDrop = true;



      if (holeMask && holeMask[targetRow + 1]) {



        for (let c = b.col; c < b.col + b.length; c++) {



          if (holeMask[targetRow + 1][c]) { canDrop = false; break; }



        }



      }



      if (canDrop) {



        for (const other of simBlocks) {



          if (other.id === b.id) continue;



          const otherRow = simulatedRows[other.id] !== undefined ? simulatedRows[other.id] : other.row;



          if (otherRow === targetRow + 1) {



            if (b.col < other.col + other.length && b.col + b.length > other.col) {



              canDrop = false;



              break;



            }



          }



        }



      }



      if (canDrop) targetRow++;



      else break;



    }



    simulatedRows[b.id] = targetRow;



  });



  



  simBlocks.forEach(b => {



    b.row = simulatedRows[b.id];



  });



}







// Fixed Board Mode / Gravity check helper for auto-play script generator



function checkSimEliminations(simBlocks: SimBlock[]): number[] {
  const fullRows = getSimFullRows(simBlocks);



  



  // Keep auto-play simulation aligned with the live board rules.

  for (let i = simBlocks.length - 1; i >= 0; i--) {

    const b = simBlocks[i];

    if (!b.isProp) continue;

    const damage = damagePropForClearedRows(b, fullRows);

    if (!damage.triggered) continue;



    b.col = damage.col;

    b.length = damage.length;

    if (damage.destroyed) simBlocks.splice(i, 1);

  }





  return fullRows;



}







function simulateSimMove(simBlocks: SimBlock[], blockId: number, targetCol: number): {



  success: boolean;



  eliminationWaves: number[][];



  totalCleared: number;



} {



  const block = simBlocks.find(b => b.id === blockId);



  if (!block) return { success: false, eliminationWaves: [], totalCleared: 0 };



  



  const { minCol, maxCol } = getSimMoveBounds(simBlocks, block);



  if (targetCol < minCol || targetCol > maxCol || targetCol === block.col) {



    return { success: false, eliminationWaves: [], totalCleared: 0 };



  }



  



  block.col = targetCol;



  



  const eliminationWaves: number[][] = [];



  let totalCleared = 0;



  



  while (true) {



    applySimGravity(simBlocks);



    const fullRows = checkSimEliminations(simBlocks);



    if (fullRows.length === 0) break;



    



    // Remove blocks in full rows



    for (let i = simBlocks.length - 1; i >= 0; i--) {



      if (!simBlocks[i].isProp && fullRows.includes(simBlocks[i].row)) {



        simBlocks.splice(i, 1);



      }



    }



    eliminationWaves.push(fullRows);



    totalCleared += fullRows.length;



  }



  



  return { success: true, eliminationWaves, totalCleared };



}







function getSimPossibleMoves(simBlocks: SimBlock[], minRow?: number, maxRow?: number): SimMove[] {



  const moves: SimMove[] = [];



  simBlocks.forEach(b => {

    // Props are fixed obstacles — skip them in auto-generation
    if (b.isProp) return;




    if (minRow !== undefined && maxRow !== undefined) {



      if (b.row < minRow || b.row > maxRow) {



        return;



      }



    }



    const { minCol, maxCol } = getSimMoveBounds(simBlocks, b);



    for (let toCol = minCol; toCol <= maxCol; toCol++) {



      if (toCol === b.col) continue;



      



      const cloneBlocks: SimBlock[] = simBlocks.map(sb => ({ ...sb }));



      const simResult = simulateSimMove(cloneBlocks, b.id, toCol);



      if (simResult.success) {



        let maxElimRowsInWave = 0;



        simResult.eliminationWaves.forEach(w => {



          if (w.length > maxElimRowsInWave) maxElimRowsInWave = w.length;



        });







        let dropDistance = 0;



        const newB = cloneBlocks.find(cb => cb.id === b.id);



        if (newB) {



          dropDistance = newB.row - b.row;



        }







        moves.push({



          blockId: b.id,



          fromCol: b.col,



          toCol,



          row: b.row,



          causesElimination: simResult.totalCleared > 0,



          comboCount: simResult.eliminationWaves.length,



          totalCleared: simResult.totalCleared,



          maxElimRowsInWave,



          dropDistance



        });



      }



    }



  });



  



  // Calculate distance from highest block to minRow (top of viewport)



  const topmostRow = simBlocks.length > 0 ? Math.min(...simBlocks.map(b => b.row)) : 0;



  const distanceToTop = minRow !== undefined ? (topmostRow - minRow) : 999;



  const midRow = minRow !== undefined && maxRow !== undefined ? Math.round((minRow + maxRow) / 2) : 0;







  // Quality-based sort: rank by combo/clear quality, but do NOT deterministically



  // force elim vs non-elim ordering (that's handled by randomization in the caller).'



  moves.sort((a, b) => {



    // Higher combos first (when both cause elimination)



    if (a.causesElimination && b.causesElimination) {



      if (a.comboCount !== b.comboCount) return b.comboCount - a.comboCount;



      if (a.totalCleared !== b.totalCleared) return b.totalCleared - a.totalCleared;



    }



    



    // For non-eliminating moves, prioritize those that drop the block further down (packing)



    if (!a.causesElimination && !b.causesElimination) {



      const dropA = a.dropDistance || 0;



      const dropB = b.dropDistance || 0;



      if (dropA !== dropB) return dropB - dropA;



    }



    



    // Prioritize moves closer to the middle of the screen



    const distMidA = Math.abs(a.row - midRow);



    const distMidB = Math.abs(b.row - midRow);



    if (distMidA !== distMidB) return distMidA - distMidB;



    



    return 0;



  });



  



  return moves;



}







function getSimStepDuration(causesElimination: boolean, comboCount: number): number {



  const durInput = document.getElementById('input-script-duration') as HTMLInputElement;



  const slideDelayInput = document.getElementById('input-script-delay-slide') as HTMLInputElement;



  const elimDelayInput = document.getElementById('input-script-delay-elim') as HTMLInputElement;



  const stepDelayInput = document.getElementById('input-script-delay-step') as HTMLInputElement;







  const slideDur = durInput ? (parseFloat(durInput.value) || 0.3) : 0.3;



  const slideDelay = slideDelayInput ? (parseFloat(slideDelayInput.value) || 0.15) : 0.15;



  const elimDelay = elimDelayInput ? (parseFloat(elimDelayInput.value) || 0.1) : 0.1;



  const stepDelay = stepDelayInput ? (parseFloat(stepDelayInput.value) || 0.5) : 0.5;



  const gravityDur = PARAMS.gravityDuration || 0.4;



  const totalStagger = (PARAMS.shatterMode === 2) ? 0 : 0.5;







  let totalAnimTime = slideDur + slideDelay + gravityDur;



  if (causesElimination && comboCount > 0) {



    totalAnimTime += comboCount * (totalStagger + 0.1 + elimDelay + gravityDur);



  }



  totalAnimTime += stepDelay;



  return totalAnimTime;



}







function searchDemoScript(



  simBlocks: SimBlock[],



  depth: number,



  targetDepth: number,



  nonElimStreak: number,



  hasCombo: boolean,



  hasMulti: boolean,



  visited: Set<string>,



  startTime: number,



  timeoutMs: number,



  params: {



    maxNonElim: number;



    minCombo: number;



    requireMulti: boolean;



    minVisibleRow: number;



    maxVisibleRow: number;



    scrollY: number;



    scrollRow: number;



    targetDuration?: number;



    firstElimStep: number;



  },



  prevBlockId: number | null = null,



  accumulatedTime: number = 0,



  hasEliminated: boolean = false



): { success: boolean; path: any[] } {



  if (Date.now() - startTime > timeoutMs) {



    return { success: false, path: [] };



  }



  



  if (params.targetDuration !== undefined && accumulatedTime >= params.targetDuration - 1.0) {



    const satisfiedCombo = params.minCombo === 0 || hasCombo;



    const satisfiedMulti = !params.requireMulti || hasMulti;



    if (satisfiedCombo && satisfiedMulti) {



      return { success: true, path: [] };



    }



  }







  if (depth === targetDepth) {



    if (params.targetDuration === undefined) {



      const satisfiedCombo = params.minCombo === 0 || hasCombo;



      const satisfiedMulti = !params.requireMulti || hasMulti;



      if (satisfiedCombo && satisfiedMulti) {



        return { success: true, path: [] };



      }



    }



    return { success: false, path: [] };



  }



  



  const stateKey = simBlocks.map(b => b.id + ":" + b.col + ":" + b.row).sort().join(';');



  if (visited.has(stateKey)) {



    return { success: false, path: [] };



  }



  visited.add(stateKey);



  



  const topmostRow = simBlocks.length > 0 ? Math.min(...simBlocks.map(b => b.row)) : 0;



  let allowedMaxRow = params.maxVisibleRow - 2;



  if (topmostRow > allowedMaxRow) {



    allowedMaxRow = params.maxVisibleRow;



  }



  const possibleMoves = getSimPossibleMoves(simBlocks, params.minVisibleRow, allowedMaxRow);



  



  // Randomize move order to avoid always-max non-elim streaks:



  // Shuffle moves with Fisher-Yates within groups (elim vs non-elim)



  for (let i = possibleMoves.length - 1; i > 0; i--) {



    const j = Math.floor(Math.random() * (i + 1));



    [possibleMoves[i], possibleMoves[j]] = [possibleMoves[j], possibleMoves[i]];



  }



  // Re-sort: only force elim-first when near top (distanceToTop <= 3),



  // otherwise keep random order (both elim and non-elim mixed)



  const topmostRowForSort = simBlocks.length > 0 ? Math.min(...simBlocks.map(b => b.row)) : 0;



  const distToTopForSort = params.minVisibleRow !== undefined ? (topmostRowForSort - params.minVisibleRow) : 999;



  if (distToTopForSort <= 3) {



    // Emergency: force elimination moves to front



    possibleMoves.sort((a, b) => {



      if (a.causesElimination !== b.causesElimination) {



        return a.causesElimination ? -1 : 1;



      }



      return 0; // keep random order within group



    });



  }



  // If first elimination is required by step N and we haven't eliminated yet,'



  // force only elimination moves at the deadline step



  const mustElimNow = !hasEliminated && depth >= params.firstElimStep - 1;



  



  for (const move of possibleMoves) {



    if (prevBlockId !== null && move.blockId === prevBlockId) {



      continue;



    }



    



    // Enforce firstElimStep: at or past the deadline, only allow elimination moves



    if (mustElimNow && !move.causesElimination) {



      continue;



    }







    let nextNonElimStreak = move.causesElimination ? 0 : nonElimStreak + 1;



    if (nextNonElimStreak > params.maxNonElim) {



      continue;



    }



    



    let nextHasCombo = hasCombo || (move.comboCount >= params.minCombo && move.comboCount >= 2);



    let nextHasMulti = hasMulti || (move.maxElimRowsInWave >= 2);



    



    const nextBlocks: SimBlock[] = simBlocks.map(sb => ({ ...sb }));



    const simResult = simulateSimMove(nextBlocks, move.blockId, move.toCol);



    



    let nextScrollY = params.scrollY;



    const activeMode = getActiveBoardAdvanceMode();



    const stepDur = getSimStepDuration(move.causesElimination, move.comboCount);



    if (activeMode === 'scroll') {



      let currentSpeed = PARAMS.scrollSpeed;



      const topmostRow = nextBlocks.length > 0 ? Math.min(...nextBlocks.map(b => b.row)) : PARAMS.totalRows;



      const highestBlockY = topmostRow * PARAMS.cellSize;



      const minVisibleY = -params.scrollY;



      const distanceToTopInPixels = highestBlockY - minVisibleY;



      



      const warningThreshold = 4 * PARAMS.cellSize;



      if (distanceToTopInPixels < warningThreshold) {



        const factor = Math.max(0.1, distanceToTopInPixels / warningThreshold);



        currentSpeed = Math.round(PARAMS.scrollSpeed * factor);



      }



      nextScrollY -= currentSpeed * stepDur;



    } else if (activeMode === 'rising') {



      const topmostRow = nextBlocks.length > 0 ? Math.min(...nextBlocks.map(b => b.row)) : PARAMS.totalRows;



      const minVisibleY = -params.scrollY;



      const distanceToTop = topmostRow - Math.max(0, Math.floor(minVisibleY / PARAMS.cellSize));



      



      let rowsRisen = 0;



      if (move.causesElimination) {



        if (distanceToTop <= 4) {



          rowsRisen = 0;



        } else {



          rowsRisen = Math.min(move.comboCount, 2);



        }



      } else {



        if (distanceToTop <= 2) {



          rowsRisen = 0;



        } else {



          rowsRisen = 1;



        }



      }



      nextScrollY -= rowsRisen * PARAMS.cellSize;



    }



    



    const minY = getBottomWorldY();



    if (nextScrollY < minY) {



      nextScrollY = minY;



    }







    // Prune paths that trigger top-reaching game over / failure



    const nextMinVisibleY = -nextScrollY;



    const reachesTop = nextBlocks.some(b => b.row * PARAMS.cellSize <= nextMinVisibleY + 1);



    if (reachesTop) {



      continue;



    }



    



    const cellSize = PARAMS.cellSize || 50;



    const nextMinVisibleRow = Math.max(0, Math.floor(-nextScrollY / cellSize));



    const nextMaxVisibleRow = Math.min(



      PARAMS.totalRows - 1,



      Math.floor((-nextScrollY + getViewportGameHeight() - 1) / cellSize)



    );



    const nextScrollRow = getScrollRowFromWorldY(nextScrollY);







    const nextParams = {



      ...params,



      scrollY: nextScrollY,



      scrollRow: nextScrollRow,



      minVisibleRow: nextMinVisibleRow,



      maxVisibleRow: nextMaxVisibleRow



    };







    const nextHasEliminated = hasEliminated || move.causesElimination;



    const res = searchDemoScript(



      nextBlocks,



      depth + 1,



      targetDepth,



      nextNonElimStreak,



      nextHasCombo,



      nextHasMulti,



      visited,



      startTime,



      timeoutMs,



      nextParams,



      move.blockId,



      accumulatedTime + stepDur,



      nextHasEliminated



    );



    



    if (res.success) {



      const bInfo = simBlocks.find(b => b.id === move.blockId)!;



      const stepData = {



        blockId: move.blockId,



        fromCol: move.fromCol,



        toCol: move.toCol,



        row: move.row,



        color: bInfo.color,



        length: bInfo.length,



        eliminationWaves: simResult.eliminationWaves,



        totalCleared: simResult.totalCleared,



        scrollY: params.scrollY,



        scrollRow: params.scrollRow,



        gravityMaxRow: PARAMS.totalRows - 1,



        eliminatedRows: simResult.eliminationWaves.flat()



      };



      return { success: true, path: [stepData, ...res.path] };



    }



  }



  



  visited.delete(stateKey);



  return { success: false, path: [] };



}







function autoAlignPlaybackDuration(steps: any[], targetDuration: number) {



  const durInput = document.getElementById('input-script-duration') as HTMLInputElement;



  const slideDelayInput = document.getElementById('input-script-delay-slide') as HTMLInputElement;



  const elimDelayInput = document.getElementById('input-script-delay-elim') as HTMLInputElement;



  const stepDelayInput = document.getElementById('input-script-delay-step') as HTMLInputElement;







  const slideDur = durInput ? (parseFloat(durInput.value) || 0.3) : 0.3;



  const slideDelay = slideDelayInput ? (parseFloat(slideDelayInput.value) || 0.15) : 0.15;



  const elimDelay = elimDelayInput ? (parseFloat(elimDelayInput.value) || 0.1) : 0.1;



  const stepDelay = stepDelayInput ? (parseFloat(stepDelayInput.value) || 0.5) : 0.5;



  const gravityDur = PARAMS.gravityDuration || 0.4;



  const totalStagger = (PARAMS.shatterMode === 2) ? 0 : 0.5;



  const cellSize = PARAMS.cellSize || 50;







  // Calculate per-step animation time and rows cleared



  const stepInfos: { animTime: number; rowsCleared: number }[] = [];



  let totalAnimTime = 0;







  steps.forEach((step, idx) => {



    let stepTime = slideDur + slideDelay + gravityDur;



    const elimWavesCount = step.eliminationWaves ? step.eliminationWaves.length : 0;



    let rowsCleared = 0;



    if (elimWavesCount > 0) {



      stepTime += elimWavesCount * (totalStagger + 0.1 + elimDelay + gravityDur);



      // Count unique rows cleared across all waves



      const allRows = new Set<number>();



      for (const wave of step.eliminationWaves) {



        if (Array.isArray(wave)) {



          wave.forEach((r: number) => allRows.add(r));



        }



      }



      rowsCleared = allRows.size;



    }



    if (idx < steps.length - 1) {



      stepTime += stepDelay;



    }



    // Add safety factor for async overhead per step



    stepTime *= 1.15;



    stepInfos.push({ animTime: stepTime, rowsCleared });



    totalAnimTime += stepTime;



  });







  console.log('[AutoPlay Generator] Estimated play duration for ' + steps.length + ' steps: ' + totalAnimTime.toFixed(2) + 's (Target: ' + targetDuration + 's)');







  const initialY = worldContainer ? worldContainer.y : 0;



  const bottomY = getBottomWorldY();



  const totalScrollDistance = Math.abs(bottomY - initialY);







  if (totalAnimTime > 0 && totalScrollDistance > 0) {



    // Target: blocks should fill ~3/4 of the viewport at all times.



    // So the allowed headroom (empty space at top) is 1/4 of the viewport height.



    const viewportHeight = getViewportGameHeight();



    const targetHeadroom = viewportHeight * 0.25;







    // Simple approach: calculate speed from total distance/time, then verify



    // it doesn't cause overflow at any step. If it does, reduce it.'



    let candidateSpeed = totalScrollDistance / totalAnimTime;







    // Simulate step by step to find max safe speed



    let maxDebt = 0;



    let cumulativeDebt = 0;



    for (const info of stepInfos) {



      // Pixels scrolled in during this step



      const scrolledIn = candidateSpeed * info.animTime;



      // Pixels freed by elimination



      const freed = info.rowsCleared * cellSize;



      cumulativeDebt += (scrolledIn - freed);



      if (cumulativeDebt > maxDebt) {



        maxDebt = cumulativeDebt;



      }



    }







    // If maxDebt exceeds target headroom, scale down the speed proportionally



    if (maxDebt > 0 && maxDebt > targetHeadroom) {



      const safeRatio = Math.max(0.1, targetHeadroom / maxDebt);



      candidateSpeed *= safeRatio;



      console.log('[AutoPlay Generator] Speed adjusted for 3/4 fill. TargetHeadroom: ' + targetHeadroom.toFixed(0) + 'px, MaxDebt: ' + maxDebt.toFixed(0) + 'px, Ratio: ' + safeRatio.toFixed(2));



    }







    const finalSpeed = Math.max(5, Math.min(500, Math.round(candidateSpeed)));



    PARAMS.scrollSpeed = finalSpeed;







    // Sync all speed controls in the UI



    const speedInput = document.getElementById('input-speed') as HTMLInputElement;



    const speedSlider = document.getElementById('slider-speed') as HTMLInputElement;



    const speedVal = document.getElementById('val-speed');



    const scriptSpeedInput = document.getElementById('input-script-scroll-speed') as HTMLInputElement;







    if (speedInput) speedInput.value = finalSpeed.toString();



    if (speedSlider) speedSlider.value = finalSpeed.toString();



    if (speedVal) speedVal.innerText = finalSpeed.toString();



    if (scriptSpeedInput) scriptSpeedInput.value = finalSpeed.toString();







    console.log('[AutoPlay Generator] Final scroll speed: ' + finalSpeed + ' px/s (total distance: ' + totalScrollDistance.toFixed(0) + 'px, total time: ' + totalAnimTime.toFixed(2) + 's, targetHeadroom: ' + targetHeadroom.toFixed(0) + 'px)');



  }



}







function bindAutoplayGeneratorEvents() {



  const btnGen = document.getElementById('btn-autoplay-generate');



  const statusDiv = document.getElementById('autoplay-status');



  



  if (!btnGen) return;



  



  btnGen.addEventListener('click', () => {



    if (isPlayingScript) {



      alert('正在播放剧本演示，请先暂停播放');



      return;



    }



    



    if (blocks.length === 0) {



      alert('当前棋盘为空，请先在左侧画排面或随机生成排面');



      return;



    }



    



    const targetDuration = parseFloat((document.getElementById('input-autoplay-target-duration') as HTMLInputElement)?.value) || 30;



    const timeoutSeconds = parseFloat((document.getElementById('input-autoplay-timeout') as HTMLInputElement)?.value) || 30;



    const maxNonElim = parseInt((document.getElementById('input-autoplay-max-non-elim') as HTMLInputElement)?.value) || 2;



    const minCombo = parseInt((document.getElementById('input-autoplay-min-combo') as HTMLInputElement)?.value) || 0;



    const requireMulti = (document.getElementById('input-autoplay-require-multi') as HTMLInputElement)?.checked || false;



    const firstElimStep = parseInt((document.getElementById('input-autoplay-first-elim-step') as HTMLInputElement)?.value) || 999;



    



    if (statusDiv) {



      statusDiv.style.display = 'block';



      statusDiv.style.color = '#ffaa00';



      statusDiv.innerText = '🔍 正在分析排面并搜寻解答，请稍候...';



    }



    



    setTimeout(() => {



      const startTime = Date.now();



      const timeoutMs = timeoutSeconds * 1000;



      



      const simBlocks: SimBlock[] = blocks.map(b => ({



        id: b.id,



        col: b.col,



        row: b.row,



        length: b.length,



        color: b.color,



        isProp: b.isProp,



        propType: b.propType,

        propDir: b.propDir



      }));



      



      captureBoardState();



      



      const viewportY = worldContainer ? worldContainer.y : 0;



      const cellSize = PARAMS.cellSize || 50;



      const minVisibleRow = Math.max(0, Math.floor(-viewportY / cellSize));



      const maxVisibleRow = Math.min(



        PARAMS.totalRows - 1,



        Math.floor((-viewportY + getViewportGameHeight() - 1) / cellSize)



      );



      



      console.log('[AutoPlay Generator] Viewport bounds:', { viewportY, minVisibleRow, maxVisibleRow });







      // Pre-calculate scroll speed based on target duration to avoid discrepancy in search simulation



      const bottomY = getBottomWorldY();



      const totalScrollDistance = Math.abs(bottomY - viewportY);



      const preSpeed = Math.max(5, Math.min(500, Math.round(totalScrollDistance / targetDuration)));

      const preSavedManualSpeed = PARAMS.scrollSpeed; // save user's manual speed before auto-gen overrides it
      PARAMS.scrollSpeed = preSpeed;







      const speedInput = document.getElementById('input-speed') as HTMLInputElement;



      const speedSlider = document.getElementById('slider-speed') as HTMLInputElement;



      const speedVal = document.getElementById('val-speed');



      const scriptSpeedInput = document.getElementById('input-script-scroll-speed') as HTMLInputElement;







      if (speedInput) speedInput.value = preSpeed.toString();



      if (speedSlider) speedSlider.value = preSpeed.toString();



      if (speedVal) speedVal.innerText = preSpeed.toString();



      if (scriptSpeedInput) scriptSpeedInput.value = preSpeed.toString();







      console.log('[AutoPlay Generator] Pre-adjusted scroll speed to: ' + preSpeed + ' px/s (total distance: ' + totalScrollDistance + ' px)');







      const maxSearchDepth = Math.min(40, Math.max(15, Math.ceil(targetDuration / 1.0)));



      



      let solvedPath: any[] | null = null;



      let finalDepth = 0;



      



      console.log('[AutoPlay Generator] Searching for script with playback duration >= ' + targetDuration + 's (max depth limit: ' + maxSearchDepth + ')...');



      const visited = new Set<string>();



      const res = searchDemoScript(



        simBlocks,



        0,



        maxSearchDepth,



        0,



        false,



        false,



        visited,



        startTime,



        timeoutMs,



        { 



          maxNonElim, 



          minCombo, 



          requireMulti,



          minVisibleRow,



          maxVisibleRow,



          scrollY: viewportY,



          scrollRow: getScrollRowFromWorldY(viewportY),



          targetDuration,



          firstElimStep



        },



        null,



        0,



        false



      );



      



      if (res.success && res.path && res.path.length > 0) {



        solvedPath = res.path;



        finalDepth = res.path.length;



      }



      



      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);



      



      if (solvedPath) {



        scriptSteps = solvedPath;



        autoAlignPlaybackDuration(scriptSteps, targetDuration); // sets PARAMS.scrollSpeed to auto-computed value
        autoGenScrollSpeed = PARAMS.scrollSpeed; // save auto-computed speed

        // Restore the user's manual speed so manual playback is not affected
        PARAMS.scrollSpeed = preSavedManualSpeed;
        const _si2 = document.getElementById('input-speed') as HTMLInputElement;
        const _ss2 = document.getElementById('slider-speed') as HTMLInputElement;
        const _sv2 = document.getElementById('val-speed');
        const _sp2 = document.getElementById('input-script-scroll-speed') as HTMLInputElement;
        if (_si2) _si2.value = preSavedManualSpeed.toString();
        if (_ss2) _ss2.value = preSavedManualSpeed.toString();
        if (_sv2) _sv2.innerText = preSavedManualSpeed.toString();
        if (_sp2) _sp2.value = preSavedManualSpeed.toString();
        // Show the dedicated auto-gen play buttons
        const _agBtns = document.getElementById('autogen-play-buttons');
        if (_agBtns) _agBtns.style.display = 'flex';




        



        if (statusDiv) {



          statusDiv.style.color = '#00ff66';



          statusDiv.innerText = '✅ 生成成功！共 ' + scriptSteps.length + ' 步 (耗时 ' + elapsed + 's)';



        }



        



        selectedStepIndex = null;



        updateScriptUI();



        restoreBoardState();



        



        console.log('[AutoPlay Generator] Successfully generated script with ' + scriptSteps.length + ' steps at depth ' + finalDepth + ' in ' + elapsed + 's');



      } else {



        if (statusDiv) {



          statusDiv.style.color = '#ff3366';



          statusDiv.innerText = '❌ 未能在限制内搜寻到可行解 (耗时 ' + elapsed + 's)\n请尝试：1. 增加无消步数；2. 取消连消/多消限制。';



        }



      }



    }, 50);



  });




  // ── Dedicated auto-gen play buttons ──────────────────────────────────
  function applyAutoGenSpeedAndPlay(autoScroll: boolean, rising: boolean): void {
    if (autoGenScrollSpeed === null) { alert('请先点击「自动生成步骤演示」生成演示脚本'); return; }
    isPlayingAutoGenScript = true;
    const savedSpeed = PARAMS.scrollSpeed;
    PARAMS.scrollSpeed = autoGenScrollSpeed;
    const _si = document.getElementById('input-speed') as HTMLInputElement;
    const _ss3 = document.getElementById('slider-speed') as HTMLInputElement;
    const _sv3 = document.getElementById('val-speed');
    const _sp3 = document.getElementById('input-script-scroll-speed') as HTMLInputElement;
    if (_si) _si.value = autoGenScrollSpeed.toString();
    if (_ss3) _ss3.value = autoGenScrollSpeed.toString();
    if (_sv3) _sv3.innerText = autoGenScrollSpeed.toString();
    if (_sp3) _sp3.value = autoGenScrollSpeed.toString();
    playScriptFromButton(autoScroll, rising).finally(() => {
      isPlayingAutoGenScript = false;
      PARAMS.scrollSpeed = savedSpeed;
      if (_si) _si.value = savedSpeed.toString();
      if (_ss3) _ss3.value = savedSpeed.toString();
      if (_sv3) _sv3.innerText = savedSpeed.toString();
      if (_sp3) _sp3.value = savedSpeed.toString();
    });
  }
  const btnAgPlay       = document.getElementById('btn-autogen-play');
  const btnAgPlayRising = document.getElementById('btn-autogen-play-rising');
  const btnAgPlayScroll = document.getElementById('btn-autogen-play-scroll');
  if (btnAgPlay)       btnAgPlay.addEventListener('click',       () => applyAutoGenSpeedAndPlay(false, false));
  if (btnAgPlayRising) btnAgPlayRising.addEventListener('click', () => applyAutoGenSpeedAndPlay(false, true));
  if (btnAgPlayScroll) btnAgPlayScroll.addEventListener('click', () => applyAutoGenSpeedAndPlay(true,  false));

}







// Register generator events when document is ready



if (document.readyState === 'loading') {



  document.addEventListener('DOMContentLoaded', bindAutoplayGeneratorEvents);



} else {



  bindAutoplayGeneratorEvents();

}







function getPlayableTutorialTarget() {
  if (!app || !worldContainer || !Array.isArray(blocks) || blocks.length === 0) return null;

  const simBlocks: SimBlock[] = blocks.map(b => ({
    id: b.id,
    col: b.col,
    row: b.row,
    length: b.length,
    color: b.color,
    isProp: b.isProp,
    propType: b.propType,
    propDir: b.propDir
  }));

  // Exported playables open at row 0. The editor camera can be scrolled to a
  // different position, so it must not decide whether a tutorial move exists.
  const tutorialRows = getTutorialSearchRows(PARAMS.totalRows, PARAMS.viewportRows);
  const openingMidRow = (tutorialRows.minRow + tutorialRows.maxRow) / 2;
  const sortedBlocks = [...blocks].sort((a, b) => Math.abs(a.row - openingMidRow) - Math.abs(b.row - openingMidRow));
  const candidates: Array<{
    blockId: number;
    fromCol: number;
    toCol: number;
    row: number;
    totalCleared: number;
    firstWaveRows: number[];
  }> = [];

  for (const block of sortedBlocks) {
    if (block.isCollectible || block.isProp) continue;
    const simBlock = simBlocks.find(b => b.id === block.id);
    if (!simBlock) continue;

    const { minCol, maxCol } = getSimMoveBounds(simBlocks, simBlock);
    for (let toCol = minCol; toCol <= maxCol; toCol++) {
      if (toCol === block.col) continue;
      const cloneBlocks: SimBlock[] = simBlocks.map(sb => ({ ...sb }));

      // Match the live move sequence: slide, gravity if needed, then elimination.
      // A tutorial target is valid only when that exact sequence clears an
      // authored row visible in the exported opening.
      const simResult = simulateSimMove(cloneBlocks, block.id, toCol);
        const firstWaveRows = simResult.eliminationWaves[0] || [];
        const visibleFirstWaveRows = firstWaveRows.filter(
          row => row >= tutorialRows.minRow && row <= tutorialRows.maxRow,
        );
        if (visibleFirstWaveRows.length > 0) {
        candidates.push({
          blockId: block.id,
          fromCol: block.col,
          toCol,
          totalCleared: simResult.totalCleared,
          row: block.row,
            firstWaveRows: visibleFirstWaveRows,
        });
      }
    }
  }

  const selected = pickTutorialEliminationMove(candidates);
  if (!selected) return null;

  const block = blocks.find(item => item.id === selected.blockId);
  if (!block) return null;

  return {
    block,
    dir: selected.toCol > selected.fromCol ? 1 : -1,
    cells: Math.abs(selected.toCol - selected.fromCol),
    toCol: selected.toCol,
    eliminationRow: selected.firstWaveRows[0],
    totalCleared: selected.totalCleared,
  };
}



function getImmediatePlayableFullRows(): number[] {
  const occ = getGridOccupancy();
  const minVisibleY = -worldContainer.y;
  const minRow = Math.max(0, Math.floor(minVisibleY / PARAMS.cellSize));
  const maxRow = getVisibleBottomRowForWorldY(worldContainer.y);
  const fullRows: number[] = [];

  for (let r = minRow; r <= maxRow; r++) {
    let isFull = true;
    for (let c = 0; c < PARAMS.gridCols; c++) {
      if (occ[r][c] === 0) {
        isFull = false;
        break;
      }
    }
    if (isFull) fullRows.push(r);
  }

  return fullRows;
}



function getSimFullRows(simBlocks: SimBlock[], minRow = 0, maxRow = PARAMS.totalRows - 1): number[] {
  const occ = getSimOccupancy(simBlocks);
  const fullRows: number[] = [];
  const start = Math.max(0, minRow);
  const end = Math.min(PARAMS.totalRows - 1, maxRow);

  for (let r = start; r <= end; r++) {
    let isFull = true;
    for (let c = 0; c < PARAMS.gridCols; c++) {
      if (occ[r][c] === 0) {
        isFull = false;
        break;
      }
    }
    if (isFull) fullRows.push(r);
  }

  return fullRows;
}



function syncBoardFrameToGrid() {

  const boardWrapper = document.getElementById('board-wrapper');

  if (!boardWrapper) return;



  const gameWidth = PARAMS.gridCols * PARAMS.cellSize + PADDING * 2;
  const gameHeight = PARAMS.viewportRows * PARAMS.cellSize + PADDING * 2;

  boardWrapper.style.setProperty('--board-grid-aspect', `${gameWidth} / ${gameHeight * BOARD_FRAME_VERTICAL_SCALE}`);

}



function getActiveBoardMechanic(): BoardMechanic {



  if (isFallingMode) return 'falling';



  return scriptPlaybackAdvanceMode || boardMechanic;



}



function setBoardMechanic(mechanic: BoardMechanic, persist = true) {



  boardMechanic = mechanic;



  isFallingMode = mechanic === 'falling';



  boardAdvanceMode = mechanic === 'falling' ? 'fixed' : mechanic;



  isFixedBoardMode = mechanic === 'fixed';



  if (persist) localStorage.setItem('boardMechanic', mechanic);



}

function getBlockScreenRect(block: Block) {
  if (!app || !block?.sprite) return null;
  const canvas = app.canvas as HTMLCanvasElement;
  const canvasRect = canvas.getBoundingClientRect();
  const topLeft = block.sprite.getGlobalPosition();
  const scaleX = canvasRect.width / app.screen.width;
  const scaleY = canvasRect.height / app.screen.height;
  return {
    left: canvasRect.left + topLeft.x * scaleX,
    top: canvasRect.top + topLeft.y * scaleY,
    width: block.sprite.width * scaleX,
    height: block.sprite.height * scaleY
  };
}

function getConfiguredPlayableTutorialTarget() {
  const config = (window as any).PLAYABLE_CONFIG;
  if (!config?.initialState) return null;

  try {
    const savedState = JSON.parse(config.initialState);
    const savedTarget = savedState?.tutorialTarget;
    if (!savedTarget || !Number.isFinite(Number(savedTarget.blockId))) return null;

    const block = blocks.find(item => item.id === Number(savedTarget.blockId));
    if (!block || block.isCollectible || block.isProp) return null;

    const toCol = Number(savedTarget.toCol);
    const dir = Number(savedTarget.dir);
    const cells = Number(savedTarget.cells);
    const eliminationRow = Number(savedTarget.eliminationRow);
    if (!Number.isFinite(toCol) || !Number.isFinite(dir) || !Number.isFinite(cells) || !Number.isFinite(eliminationRow)) {
      return null;
    }

    return {
      block,
      dir: dir >= 0 ? 1 : -1,
      cells: Math.max(1, Math.abs(cells)),
      toCol,
      eliminationRow,
      totalCleared: Math.max(1, Number(savedTarget.totalCleared) || 1),
    };
  } catch {
    return null;
  }
}

function showPlayableTutorialGuide() {
  const config = (window as any).PLAYABLE_CONFIG;
  if (config?.autoTutorial !== 'true' && config?.autoTutorial !== true) return;

  const removeExisting = () => {
    document.querySelectorAll('.playable-guide-overlay').forEach(el => el.remove());
  };

  const install = (attempt = 0) => {
    removeExisting();
    if (!app) {
      if (attempt < 20) window.setTimeout(() => install(attempt + 1), 100);
      return;
    }
    const canvasRect = (app.canvas as HTMLCanvasElement).getBoundingClientRect();
    // The export has already validated this move against the authored board.
    // Reuse it so viewport timing cannot make the guide disappear after load.
    const target = getConfiguredPlayableTutorialTarget() || getPlayableTutorialTarget();
    if (!target) {
      if (attempt < 20) window.setTimeout(() => install(attempt + 1), 100);
      return;
    }
    const targetRect = target ? getBlockScreenRect(target.block) : null;
    if (!targetRect || canvasRect.width <= 0 || canvasRect.height <= 0) {
      if (attempt < 20) window.setTimeout(() => install(attempt + 1), 100);
      return;
    }
    const dir = target?.dir || 1;
    const targetLength = target?.block?.length || 1;
    const scaleX = canvasRect.width / app.screen.width;
    const scaleY = canvasRect.height / app.screen.height;
    const boardLeft = canvasRect.left + PADDING * scaleX;
    const boardTop = canvasRect.top + PADDING * scaleY;
    const boardWidth = PARAMS.gridCols * PARAMS.cellSize * scaleX;
    const boardHeight = PARAMS.viewportRows * PARAMS.cellSize * scaleY;
    const cellWidth = targetRect ? targetRect.width / Math.max(1, targetLength) : boardWidth / Math.max(1, PARAMS.gridCols);
    const rowHeight = boardHeight / Math.max(1, PARAMS.viewportRows);
    const startX = targetRect ? targetRect.left + targetRect.width / 2 : canvasRect.left + canvasRect.width * 0.44;
    const startY = targetRect ? targetRect.top + targetRect.height / 2 : canvasRect.top + canvasRect.height * 0.56;
    const dx = dir * cellWidth * (target?.cells || 1);
    const eliminationRowTop = boardTop + ((target.eliminationRow * PARAMS.cellSize) + (worldContainer?.y || 0)) * scaleY;
    const rowTop = Math.max(boardTop, Math.min(boardTop + boardHeight - rowHeight, eliminationRowTop));
    const handSize = Math.max(62, Math.min(112, cellWidth * 2.35));
    const handHeight = handSize * 1.142;
    const arrowSize = Math.max(54, Math.min(92, cellWidth * 1.75));
    const guideRowCenterY = rowTop + rowHeight / 2;
    const handDemoDx = dir * Math.min(Math.abs(dx), handSize * 0.42);
    const handPosition = getTutorialHandPlacement({
      pointerX: startX,
      pointerY: guideRowCenterY,
      width: handSize,
      height: handHeight,
    });
    const handStartX = handPosition.left;
    const handStartY = handPosition.top;
    // Keep the directional arrow ahead of the hand. A one-cell tutorial move is
    // otherwise too short for the two large art assets and the hand hides it.
    const arrowDistance = Math.max(Math.abs(dx), handSize * 0.9 + arrowSize * 0.5);
    const arrowClearance = 12;
    const moveArrowCenter = startX + dir * arrowDistance;
    const handTravelLeft = Math.min(handStartX, handStartX + handDemoDx);
    const handTravelRight = Math.max(handStartX + handSize, handStartX + handDemoDx + handSize);
    const clearHandCenter = dir > 0
      ? handTravelRight + arrowSize / 2 + arrowClearance
      : handTravelLeft - arrowSize / 2 - arrowClearance;
    const requestedArrowCenter = dir > 0
      ? Math.max(moveArrowCenter, clearHandCenter)
      : Math.min(moveArrowCenter, clearHandCenter);
    const arrowCenterX = Math.max(
      boardLeft + arrowSize / 2,
      Math.min(boardLeft + boardWidth - arrowSize / 2, requestedArrowCenter),
    );
    const arrowX = arrowCenterX - arrowSize / 2;
    const arrowY = guideRowCenterY - arrowSize / 2;
    const arrowDx = dir * Math.min(cellWidth * 0.9, arrowSize * 0.36);

    const overlay = document.createElement('div');
    overlay.className = 'playable-guide-overlay';
    overlay.style.setProperty('--guide-row-left', `${Math.round(boardLeft)}px`);
    overlay.style.setProperty('--guide-row-top', `${Math.round(rowTop)}px`);
    overlay.style.setProperty('--guide-row-width', `${Math.round(boardWidth)}px`);
    overlay.style.setProperty('--guide-row-height', `${Math.round(rowHeight)}px`);
    overlay.style.setProperty('--guide-x', `${Math.round(handStartX)}px`);
    overlay.style.setProperty('--guide-y', `${Math.round(handStartY)}px`);
    overlay.style.setProperty('--guide-dx', `${Math.round(handDemoDx)}px`);
    overlay.style.setProperty('--guide-dir', `${dir}`);
    overlay.style.setProperty('--guide-hand-size', `${Math.round(handSize)}px`);
    overlay.style.setProperty('--guide-hand-height', `${Math.round(handHeight)}px`);
    overlay.style.setProperty('--guide-arrow-size', `${Math.round(arrowSize)}px`);
    overlay.style.setProperty('--guide-arrow-x', `${Math.round(arrowX)}px`);
    overlay.style.setProperty('--guide-arrow-y', `${Math.round(arrowY)}px`);
    overlay.style.setProperty('--guide-arrow-dx', `${Math.round(arrowDx)}px`);
    overlay.style.setProperty('--guide-arrow-rotation', dir > 0 ? '-90deg' : '90deg');

    const topDim = document.createElement('div');
    topDim.className = 'playable-guide-dim playable-guide-dim-top';

    const bottomDim = document.createElement('div');
    bottomDim.className = 'playable-guide-dim playable-guide-dim-bottom';

    const focus = document.createElement('div');
    focus.className = 'playable-guide-focus';

    const hand = document.createElement('div');
    hand.className = 'playable-hand-cue';
    hand.style.backgroundImage = `url("${jewelHandUrl}")`;

    const arrow = document.createElement('div');
    arrow.className = 'playable-hand-arrow';
    arrow.style.backgroundImage = `url("${jewelArrowUrl}")`;

    overlay.appendChild(topDim);
    overlay.appendChild(bottomDim);
    overlay.appendChild(focus);
    overlay.appendChild(arrow);
    overlay.appendChild(hand);
    document.body.appendChild(overlay);

    const stopTutorial = () => {
      removeExisting();
      document.removeEventListener('pointerdown', stopTutorial, true);



      if (getActiveBoardMechanic() === 'scroll') {



        continuousScrollOffset = 0;



        isGameStarted = true;



        gameTime = 0;



      }
    };
    document.addEventListener('pointerdown', stopTutorial, true);
  };

  // The standalone document can finish Pixi initialization before its first
  // animation frame is dispatched (notably when opened from a local file).
  // Use the task queue instead of relying on two visual frames so a validated
  // export always mounts its guide after the authored board exists.
  window.setTimeout(() => install(), 0);
}





init().then(() => {
  showPlayableTutorialGuide();
  if ((window as any).PLAYABLE_CONFIG && window.parent !== window) {
    window.parent.postMessage({
      type: 'block-puzzle-playable-ready',
      blockCount: (window as any).__playableLoadedBlockCount ?? 0,
    }, '*');
  }
}).catch(error => {
  console.error(error);
  if ((window as any).PLAYABLE_CONFIG && window.parent !== window) {
    window.parent.postMessage({
      type: 'block-puzzle-playable-error',
      message: error instanceof Error ? error.message : String(error),
    }, '*');
  }
});
