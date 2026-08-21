import type { CSSProperties, HTMLAttributes, SVGAttributes } from "react";
import actionsUrl from "sargam-icons/Icons/Line/si_Actions.svg";
import activityUrl from "sargam-icons/Icons/Line/si_Activity.svg";
import addUrl from "sargam-icons/Icons/Line/si_Add.svg";
import aiUrl from "sargam-icons/Icons/Line/si_AI.svg";
import aiMonitorUrl from "sargam-icons/Icons/Line/si_AI_monitor.svg";
import arrowUpUrl from "sargam-icons/Icons/Line/si_Arrow_upward.svg";
import archiveUrl from "sargam-icons/Icons/Line/si_Archive.svg";
import articleUrl from "sargam-icons/Icons/Line/si_Article.svg";
import bookUrl from "sargam-icons/Icons/Line/si_Book.svg";
import briefcaseUrl from "sargam-icons/Icons/Line/si_Briefcase.svg";
import buildingUrl from "sargam-icons/Icons/Line/si_Building.svg";
import checkUrl from "sargam-icons/Icons/Line/si_Check.svg";
import checklistUrl from "sargam-icons/Icons/Line/si_Checklist.svg";
import chevronDownUrl from "sargam-icons/Icons/Line/si_Expand_more.svg";
import chevronLeftAltUrl from "sargam-icons/Icons/Line/si_Chevron_left_alt.svg";
import chevronLeftUrl from "sargam-icons/Icons/Line/si_Chevron_left.svg";
import chevronRightAltUrl from "sargam-icons/Icons/Line/si_Chevron_right_alt.svg";
import chevronRightUrl from "sargam-icons/Icons/Line/si_Chevron_right.svg";
import chevronUpUrl from "sargam-icons/Icons/Line/si_Expand_less.svg";
import clockUrl from "sargam-icons/Icons/Line/si_Clock.svg";
import closeUrl from "sargam-icons/Icons/Line/si_Close.svg";
import codeUrl from "sargam-icons/Icons/Line/si_Code.svg";
import columnsUrl from "sargam-icons/Icons/Line/si_Columns.svg";
import cloudUrl from "sargam-icons/Icons/Line/si_Cloud.svg";
import copyUrl from "sargam-icons/Icons/Line/si_Copy.svg";
import dashboardUrl from "sargam-icons/Icons/Line/si_Dashboard.svg";
import dragIndicatorUrl from "sargam-icons/Icons/Line/si_Drag_indicator.svg";
import flowBranchUrl from "sargam-icons/Icons/Line/si_Flow_branch.svg";
import flagUrl from "sargam-icons/Icons/Line/si_Flag.svg";
import globeUrl from "sargam-icons/Icons/Line/si_Globe_detailed.svg";
import homeUrl from "sargam-icons/Icons/Line/si_Home.svg";
import mailUrl from "sargam-icons/Icons/Line/si_Mail.svg";
import inventoryUrl from "sargam-icons/Icons/Line/si_Inventory.svg";
import keyUrl from "sargam-icons/Icons/Line/si_Key.svg";
import layersUrl from "sargam-icons/Icons/Line/si_Layers.svg";
import libraryUrl from "sargam-icons/Icons/Line/si_Library_books.svg";
import lightningUrl from "sargam-icons/Icons/Line/si_Lightning.svg";
import linkUrl from "sargam-icons/Icons/Line/si_Link.svg";
import mapUrl from "sargam-icons/Icons/Line/si_Map.svg";
import memoryUrl from "sargam-icons/Icons/Line/si_Memory.svg";
import monitorUrl from "sargam-icons/Icons/Line/si_Monitor.svg";
import moreUrl from "sargam-icons/Icons/Line/si_More_horiz.svg";
import notificationsUrl from "sargam-icons/Icons/Line/si_Notifications.svg";
import maximizeUrl from "sargam-icons/Icons/Line/si_Northeast_southwest.svg";
import pinUrl from "sargam-icons/Icons/Line/si_Pin.svg";
import playUrl from "sargam-icons/Icons/Line/si_Play.svg";
import removeUrl from "sargam-icons/Icons/Line/si_Remove.svg";
import searchUrl from "sargam-icons/Icons/Line/si_Search.svg";
import serverUrl from "sargam-icons/Icons/Line/si_Server.svg";
import sparkUrl from "sargam-icons/Icons/Line/si_Spark.svg";
import starUrl from "sargam-icons/Icons/Line/si_Star.svg";
import settingsUrl from "sargam-icons/Icons/Line/si_Settings.svg";
import statusUrl from "sargam-icons/Icons/Line/si_Stop_circle.svg";
import swatchUrl from "sargam-icons/Icons/Line/si_Swatch.svg";
import targetUrl from "sargam-icons/Icons/Line/si_Target.svg";
import terminalUrl from "sargam-icons/Icons/Line/si_Terminal.svg";
import windowUrl from "sargam-icons/Icons/Line/si_Window.svg";

type IconProps = HTMLAttributes<HTMLSpanElement>;

function icon(url: string, displayName: string) {
  const Icon = ({ className = "", style, ...props }: IconProps) => (
    <span
      aria-hidden="true"
      className={`sargam-icon ${className}`}
      data-sargam-icon={displayName}
      style={{
        "--sargam-icon": `url("${url}")`,
        ...style,
      } as CSSProperties}
      {...props}
    />
  );
  Icon.displayName = displayName;
  return Icon;
}

export const Bell = icon(notificationsUrl, "notifications");
export const Activity = icon(activityUrl, "activity");
export const AI = icon(aiUrl, "ai");
export const Article = icon(articleUrl, "article");
export const Book = icon(bookUrl, "book");
export const Briefcase = icon(briefcaseUrl, "briefcase");
export const Building = icon(buildingUrl, "building");
export const ArrowUpIcon = icon(arrowUpUrl, "arrow-up");
export const ChevronLeft = icon(chevronLeftUrl, "chevron-left");
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = icon(chevronRightUrl, "chevron-right");
export const ChevronRightIcon = ChevronRight;
export const ChevronDownIcon = icon(chevronDownUrl, "chevron-down");
export const ChevronUpIcon = icon(chevronUpUrl, "chevron-up");
export const ChevronsLeft = icon(chevronLeftAltUrl, "panel-left-close");
export const ChevronsRight = icon(chevronRightAltUrl, "panel-left-open");
export const CheckIcon = icon(checkUrl, "check");
export const Checklist = icon(checklistUrl, "checklist");
export const CircleDot = icon(statusUrl, "status");
export const Columns2 = icon(columnsUrl, "columns");
export const Cloud = icon(cloudUrl, "cloud");
export const CopyIcon = icon(copyUrl, "copy");
export const DragIndicator = icon(dragIndicatorUrl, "drag-indicator");
export const FileCode2 = icon(codeUrl, "code-file");
export const Files = icon(archiveUrl, "files");
export const Folder = icon(archiveUrl, "folder");
export const GitBranch = icon(flowBranchUrl, "git-branch");
export const GitHub = ({ className = "", ...props }: SVGAttributes<SVGSVGElement>) => <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 0C5.37 0 0 5.37 0 12c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.335-1.756-1.335-1.756-1.087-.744.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.297 24 12 24 5.37 18.627 0 12 0Z" /></svg>;
export const Flag = icon(flagUrl, "flag");
export const Globe = icon(globeUrl, "globe");
export const History = icon(clockUrl, "history");
export const Home = icon(homeUrl, "home");
export const Inbox = icon(mailUrl, "inbox");
export const Inventory = icon(inventoryUrl, "inventory");
export const Key = icon(keyUrl, "key");
export const Layers = icon(layersUrl, "layers");
export const LayoutDashboard = icon(dashboardUrl, "dashboard");
export const LibraryBooks = icon(libraryUrl, "library-books");
export const Lightning = icon(lightningUrl, "lightning");
export const Link = icon(linkUrl, "link");
export const Map = icon(mapUrl, "map");
export const Maximize2 = icon(maximizeUrl, "maximize");
export const Minus = icon(removeUrl, "minimize");
export const Memory = icon(memoryUrl, "memory");
export const Monitor = icon(monitorUrl, "monitor");
export const MonitorCog = icon(aiMonitorUrl, "monitor-settings");
export const MoreHorizontal = icon(moreUrl, "more-horizontal");
export const PanelLeftClose = ChevronsLeft;
export const PanelLeftOpen = ChevronsRight;
export const Pin = icon(pinUrl, "pin");
export const Play = icon(playUrl, "play");
export const Plus = icon(addUrl, "add");
export const RefreshCw = icon(actionsUrl, "refresh");
export const Search = icon(searchUrl, "search");
export const Server = icon(serverUrl, "server");
export const Spark = icon(sparkUrl, "spark");
export const Star = icon(starUrl, "star");
export const Settings = icon(settingsUrl, "settings");
export const StopCircle = icon(statusUrl, "stop");
export const Square = icon(windowUrl, "window");
export const Swatch = icon(swatchUrl, "swatch");
export const Target = icon(targetUrl, "target");
export const Terminal = icon(terminalUrl, "terminal");
export const Trash2 = icon(removeUrl, "remove");
export const X = icon(closeUrl, "close");
export const XIcon = X;
