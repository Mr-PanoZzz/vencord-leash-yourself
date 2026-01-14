/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings, useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { findByPropsLazy, findComponentByCodeLazy, findStoreLazy } from "@webpack";
import {
    ChannelStore,
    Menu,
    PermissionsBits,
    PermissionStore,
    React,
    SelectedChannelStore,
    Toasts,
    UserStore
} from "@webpack/common";
import type { PropsWithChildren, SVGProps } from "react";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_TOP:", '.iconBadge,"top"');

interface BaseIconProps extends IconProps {
    viewBox: string;
}

interface IconProps extends SVGProps<SVGSVGElement> {
    className?: string;
    height?: string | number;
    width?: string | number;
}

function Icon({
    height = 24,
    width = 24,
    className,
    children,
    viewBox,
    ...svgProps
}: PropsWithChildren<BaseIconProps>) {
    return (
        <svg
            className={classes(className, "vc-icon")}
            role="img"
            width={width}
            height={height}
            viewBox={viewBox}
            {...svgProps}
        >
            {children}
        </svg>
    );
}

function CollarIcon(props: IconProps) {
    return (
        <Icon
            {...props}
            className={classes(props.className, "vc-collar-icon")}
            viewBox="0 0 24 24"
        >
            <path
                fill="currentColor"
                d="M7 14a3 3 0 0 1 0-6h4v2H7a1 1 0 0 0 0 2h4v2H7Zm6-6h4a3 3 0 0 1 0 6h-4v-2h4a1 1 0 0 0 0-2h-4V8Z"
            />
        </Icon>
    );
}

function UnleashIcon(props: IconProps) {
    return (
        <Icon
            {...props}
            className={classes(props.className, "vc-unleash-icon")}
            viewBox="0 0 24 24"
        >
            <path
                fill="currentColor"
                d="M12 2a6 6 0 0 0-6 6v2h2V8a4 4 0 1 1 8 0v1h2V8a6 6 0 0 0-6-6Zm-7 9 14 11-1.5 1.5L3.5 12.5 5 11Z"
            />
        </Icon>
    );
}

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    selfStream: boolean;
    selfVideo: boolean;
    sessionId: string;
    suppress: boolean;
    requestToSpeakTimestamp: string | null;
}

export const settings = definePluginSettings({
    pullOnLeashSet: {
        type: OptionType.BOOLEAN,
        description: "Automatically move you to your handler’s voice channel",
        default: true
    },
    onlyManualTrigger: {
        type: OptionType.BOOLEAN,
        description: "Only move when clicking the collar icon manually",
        default: false
    },
    leashReleaseOnLeave: {
        type: OptionType.BOOLEAN,
        description: "Disconnect when your handler leaves voice",
        default: false
    },
    autoPullBack: {
        type: OptionType.BOOLEAN,
        description: "Pull yourself back if you are moved away from your handler",
        default: false
    },
    handlerUserId: {
        type: OptionType.STRING,
        description: "Current handler user ID",
        hidden: true,
        default: ""
    },
    waitForSpace: {
        type: OptionType.BOOLEAN,
        description: "Attempt to join once the handler’s channel has space",
        default: true
    }
});

const ChannelActions: {
    disconnect: () => void;
    selectVoiceChannel: (channelId: string) => void;
} = findByPropsLazy("disconnect", "selectVoiceChannel");

const VoiceStateStore: VoiceStateStore = findStoreLazy("VoiceStateStore");
const CONNECT = 1n << 20n;

interface VoiceStateStore {
    getAllVoiceStates(): VoiceStateEntry;
    getVoiceStatesForChannel(channelId: string): VoiceStateMember;
}

interface VoiceStateEntry {
    [guildIdOrMe: string]: VoiceStateMember;
}

interface VoiceStateMember {
    [userId: string]: VoiceState;
}

function getChannelId(userId: string) {
    if (!userId) {
        return null;
    }
    try {
        const states = VoiceStateStore.getAllVoiceStates();
        for (const users of Object.values(states)) {
            if (users[userId]) {
                return users[userId].channelId ?? null;
            }
        }
    } catch (e) { }
    return null;
}

function triggerLeashPull(targetChannelId = getChannelId(settings.store.handlerUserId)) {
    if (!settings.store.handlerUserId) return;
    const myChanId = SelectedChannelStore.getVoiceChannelId();
    if (targetChannelId) {
        if (targetChannelId !== myChanId) {
            const channel = ChannelStore.getChannel(targetChannelId);
            const voiceStates = VoiceStateStore.getVoiceStatesForChannel(targetChannelId);
            const memberCount = voiceStates ? Object.keys(voiceStates).length : null;

            if (channel.type === 1 || PermissionStore.can(CONNECT, channel)) {
                if (channel.userLimit !== 0 && memberCount !== null && memberCount >= channel.userLimit && !PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)) {
                    Toasts.show({
                        message: "Handler’s channel is full",
                        id: Toasts.genId(),
                        type: Toasts.Type.FAILURE
                    });
                    return;
                }

                ChannelActions.selectVoiceChannel(targetChannelId);
                Toasts.show({
                    message: "Your handler pulled you into their voice channel",
                    id: Toasts.genId(),
                    type: Toasts.Type.SUCCESS
                });
            } else {
                Toasts.show({
                    message: "Insufficient permissions to enter your handler's voice channel",
                    id: Toasts.genId(),
                    type: Toasts.Type.FAILURE
                });
            }
        } else {
            Toasts.show({
                message: "You are already with your handler",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE
            });
        }

    } else if (myChanId) {
        if (settings.store.leashReleaseOnLeave) {
            ChannelActions.disconnect();
            Toasts.show({
                message: "Your handler left and took you with them",
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS
            });
        } else {
            Toasts.show({
                message: "Your handler left — leash released",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE
            });
        }

    } else {
        Toasts.show({
            message: "Your handler is not in a voice channel",
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE
        });
    }
}

function toggleLeash(userId: string) {
    if (settings.store.handlerUserId === userId) {
        settings.store.handlerUserId = "";
    } else {
        settings.store.handlerUserId = userId;
        if (settings.store.pullOnLeashSet) {
            triggerLeashPull();
        }
    }
}

interface UserContextProps {
    channel: Channel;
    guildId?: string;
    user: User;
}

const UserContext: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;
    const isLeashed = settings.store.handlerUserId === user.id;
    const label = isLeashed ? "Unleash" : "Leash Yourself to User";
    const icon = isLeashed ? UnleashIcon : CollarIcon;

    children.splice(-1, 0, (
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="leash-yourself"
                label={label}
                action={() => toggleLeash(user.id)}
                icon={icon}
            />
        </Menu.MenuGroup>
    ));
};

export default definePlugin({
    name: "LeashYourself",
    description: "Leash yourself to another user and be pulled into their voice channel",
    authors: [{ name: "Mr_PanoZzz", id: 939129546551210056n }],

    settings,

    patches: [
        {
            find: ".controlButtonWrapper,",
            replacement: {
                match: /(function \i\(\i\){)(.{1,200}toolbar.{1,100}mobileToolbar)/,
                replace: "$1$self.addIconToToolBar(arguments[0]);$2"
            }
        },
    ],

    contextMenus: {
        "user-context": UserContext
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (settings.store.onlyManualTrigger || !settings.store.handlerUserId) {
                return;
            }
            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (channelId !== oldChannelId) {
                    const isMe = userId === UserStore.getCurrentUser().id;
                    if (settings.store.autoMoveBack && isMe && channelId && oldChannelId) {
                        triggerLeashPull();
                        continue;
                    }

                    if (settings.store.waitForSpace && !isMe && !channelId && oldChannelId && oldChannelId !== SelectedChannelStore.getVoiceChannelId()) {
                        const channel = ChannelStore.getChannel(oldChannelId);
                        const channelVoiceStates = VoiceStateStore.getVoiceStatesForChannel(oldChannelId);
                        const memberCount = channelVoiceStates ? Object.keys(channelVoiceStates).length : null;
                        if (channel.userLimit !== 0 && memberCount !== null && memberCount === (channel.userLimit - 1) && !PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)) {
                            const users = Object.values(channelVoiceStates).map(x => x.userId);
                            if (users.includes(settings.store.handlerUserId)) {
                                triggerLeashPull(oldChannelId);
                                continue;
                            }
                        }
                    }

                    const isLeashed = settings.store.handlerUserId === userId;
                    if (!isLeashed) {
                        continue;
                    }

                    if (channelId) {
                        triggerLeashPull(channelId);
                    } else if (oldChannelId) {
                        triggerLeashPull(null);
                    }
                }
            }
        },
    },

    LeashIndicator() {
        const { plugins: { LeashYourself: { handlerUserId } } } = useSettings(["plugins.LeashYourself.handlerUserId"]);
        if (handlerUserId) {
            return (
                <HeaderBarIcon
                    tooltip={`Leashed to ${UserStore.getUser(handlerUserId).username} — click to pull, right-click to unleash`}
                    icon={UnleashIcon}
                    onClick={() => {
                        triggerLeashPull();
                    }}
                    onContextMenu={() => {
                        settings.store.handlerUserId = "";
                    }}
                />
            );
        }

        return null;
    },

    addIconToToolBar(e: { toolbar: React.ReactNode[] | React.ReactNode; }) {
        if (Array.isArray(e.toolbar)) {
            return e.toolbar.unshift(
                <ErrorBoundary noop={true} key="leash-indicator">
                    <this.LeashIndicator/>
                </ErrorBoundary>
            );
        }

        e.toolbar = [
            <ErrorBoundary noop={true} key="leash-indicator">
                <this.LeashIndicator />
            </ErrorBoundary>,
            e.toolbar,
        ];
    },
});