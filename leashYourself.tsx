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

const ChannelActions = findByPropsLazy("disconnect", "selectVoiceChannel");
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const CONNECT = 1n << 20n;

function getUserChannel(userId: string) {
    if (!userId) return null;
    const states = VoiceStateStore.getAllVoiceStates();
    for (const guild of Object.values(states)) {
        if (guild[userId]) return guild[userId].channelId ?? null;
    }
    return null;
}

function triggerLeashPull(targetChannel = getUserChannel(settings.store.handlerUserId)) {
    if (!settings.store.handlerUserId) return;

    const myChannel = SelectedChannelStore.getVoiceChannelId();

    if (targetChannel) {
        if (targetChannel === myChannel) {
            Toasts.show({
                message: "You are already with your handler",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE
            });
            return;
        }

        const channel = ChannelStore.getChannel(targetChannel);
        const voiceStates = VoiceStateStore.getVoiceStatesForChannel(targetChannel);
        const count = voiceStates ? Object.keys(voiceStates).length : 0;

        if (
            channel.userLimit &&
            count >= channel.userLimit &&
            !PermissionStore.can(PermissionsBits.MOVE_MEMBERS, channel)
        ) {
            Toasts.show({
                message: "Handler’s channel is full",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE
            });
            return;
        }

        ChannelActions.selectVoiceChannel(targetChannel);
        Toasts.show({
            message: "Your handler pulled you into their voice channel",
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS
        });
    } else if (myChannel && settings.store.leashReleaseOnLeave) {
        ChannelActions.disconnect();
        Toasts.show({
            message: "Your handler left — leash released",
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS
        });
    }
}

function toggleLeash(userId: string) {
    settings.store.handlerUserId =
        settings.store.handlerUserId === userId ? "" : userId;

    if (settings.store.handlerUserId && settings.store.pullOnLeashSet) {
        triggerLeashPull();
    }
}

const UserContext: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user || user.id === UserStore.getCurrentUser().id) return;

    const isLeashed = settings.store.handlerUserId === user.id;

    children.splice(-1, 0, (
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="leash-yourself"
                label={isLeashed ? "Unleash" : "Leash Yourself to User"}
                action={() => toggleLeash(user.id)}
                icon={isLeashed ? UnleashIcon : CollarIcon}
            />
        </Menu.MenuGroup>
    ));
};

export default definePlugin({
    name: "LeashYourself",
    description: "Leash yourself to another user and be pulled into their voice channel",
    authors: [{ name: "Mr_PanoZzz", id: 939129546551210056n }],

    settings,
    contextMenus: { "user-context": UserContext },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }) {
            if (settings.store.onlyManualTrigger || !settings.store.handlerUserId) return;

            for (const { userId, channelId, oldChannelId } of voiceStates) {
                if (userId === settings.store.handlerUserId && channelId !== oldChannelId) {
                    triggerLeashPull(channelId ?? null);
                }
            }
        }
    },

    LeashIndicator() {
        const { plugins: { LeashYourself: { handlerUserId } } } =
            useSettings(["plugins.LeashYourself.handlerUserId"]);

        if (!handlerUserId) return null;

        return (
            <HeaderBarIcon
                tooltip={`Leashed to ${UserStore.getUser(handlerUserId).username} — click to pull, right-click to unleash`}
                icon={CollarIcon}
                onClick={() => triggerLeashPull()}
                onContextMenu={() => (settings.store.handlerUserId = "")}
            />
        );
    },

    addIconToToolBar(e) {
        const icon = (
            <ErrorBoundary noop key="leash-indicator">
                <this.LeashIndicator />
            </ErrorBoundary>
        );

        if (Array.isArray(e.toolbar)) e.toolbar.unshift(icon);
        else e.toolbar = [icon, e.toolbar];
    }
});