const Lang = imports.lang;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Util = imports.misc.util;
const MessageTray = imports.ui.messageTray;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('text-scaler');
const _ = Gettext.gettext;

const DEFAULT_VALUE = 0;
const MIN_VALUE = 0;
const MAX_VALUE = 100;
const NUM_DECIMALS = 0;
const TEXT_SCALING_FACTOR_KEY = 'text-scaling-factor';
const TIME_OUT = 600;


let brightnessManager = null;

function init() {
    Convenience.initTranslations("text-scaler");
}

function enable() {
    brightnessManager = new BrightnessManager();
    Main.panel.addToStatusArea('brightness-manager', brightnessManager);
}

function disable() {
    brightnessManager.destroy();
}

function normalizeNumber(value) {
    return Math.max(MIN_VALUE, Math.min(value, MAX_VALUE));
}

function descaleNumber(value) {
    return ((value - MIN_VALUE) / (MAX_VALUE - MIN_VALUE));
}

function scaleNumber(value) {
    return (value * (MAX_VALUE - MIN_VALUE) + MIN_VALUE).toFixed(0);
}

function isDefaultFloatValue(value) {
    return Math.abs(value - DEFAULT_VALUE) < (Math.pow(10, -NUM_DECIMALS) / 2);
}

const BrightnessManager = new Lang.Class({
    Name: 'BrightnessManager',
    Extends: PanelMenu.Button,
    _init: function () {
        this.sliderIsDragging = false;
        this.timeoutId = 0;

        this.devices = this.queryDevices();
        this.parent(0.0, "Brightness Manager");
        this.setSensitive(true);

        this.settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this.settings.connect('changed::text-scaling-factor', Lang.bind(this, this.onSettingsChanged));
        this.currentValue = this.settings.get_double(TEXT_SCALING_FACTOR_KEY);

        this.hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this.hbox.add_child(new St.Icon({
            style_class: 'system-status-icon',
            icon_name: 'dialog-information-symbolic'
        }));
        this.statusLabel = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            text: this._labelText()
        });
        this.hbox.add_child(this.statusLabel);
        this.actor.add_child(this.hbox);
        this.actor.connect('scroll-event', Lang.bind(this, this.onMenuScrollEvent));

        this._menu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.BOTTOM);
        this.setMenu(this._menu);


        this.menuItem = new PopupMenu.PopupBaseMenuItem({ activate: true });
        this.menuItem.actor.connect('key-press-event', Lang.bind(this, this.onMenuItemKeyPressed));
        this._menu.addMenuItem(this.menuItem);

        this.textEntry = new St.Entry({ style_class: 'input-text' });
        this.updateTextEntry(DEFAULT_VALUE);
        this.textEntry.clutter_text.connect('activate', Lang.bind(this, this.onEntryActivated));
        this.textEntry.clutter_text.connect('key-focus-out', Lang.bind(this, this.onEntryKeyFocusOut));
        this.menuItem.actor.add_child(this.textEntry);

        this.slider = new Slider.Slider(descaleNumber(DEFAULT_VALUE));
        this.slider.connect('value-changed', Lang.bind(this, this.onSliderValueChanged));
        this.slider.actor.x_expand = true;
        this.menuItem.actor.add_actor(this.slider.actor);


        this.separatorItem = new PopupMenu.PopupSeparatorMenuItem();
        this._menu.addMenuItem(this.separatorItem);

        this.resetValueItem = new PopupMenu.PopupMenuItem(_("Reset to default value"));
        this.resetValueItem.connect('activate', Lang.bind(this, this.onResetValueActivate));
        this._menu.addMenuItem(this.resetValueItem);
    },
    _labelText: function () {
        return this.currentValue.toString();
    },

    onSettingsChanged: function (settings, key) {
        this.updateBrightnessValue(this.settings.get_double(TEXT_SCALING_FACTOR_KEY), false);
    },

    onMenuItemKeyPressed: function (actor, event) {
        return this.slider.onKeyPressEvent(actor, event);
    },

    onEntryActivated: function (entry) {
        this.updateValueFromTextEntry(entry);
    },

    onEntryKeyFocusOut: function (entry) {
        this.updateValueFromTextEntry(entry);
    },

    onMenuScrollEvent: function (actor, event) {
        let direction = event.get_scroll_direction();
        let step = 5;
        if (direction == Clutter.ScrollDirection.DOWN) {
            step = parseInt(-step);
        } else if (direction == Clutter.ScrollDirection.UP) {
            step = parseInt(step);
        } else {
            return;
        }

        value = normalizeNumber(this.currentValue + step);
        if (!isNaN(value)) {
            this.updateBrightnessValue(value);
            this.updateSlider(descaleNumber(value));
            this.updateTextEntry(value.toString());
        }
    },

    updateValueFromTextEntry: function (entry) {
        let currentText = entry.get_text();
        let value = parseInt(currentText);

        if (isFinite(currentText) && !isNaN(currentText) && !isNaN(value)) {
            value = normalizeNumber(value);
            this.updateBrightnessValue(value.toString());
            this.updateSlider(descaleNumber(value));
            this.updateTextEntry(value);
        }
    },

    onSliderValueChanged: function (slider, value) {
        let scaled = scaleNumber(value);
        this.updateBrightnessValue(scaled);
        this.updateTextEntry(scaled);
    },

    onResetValueActivate: function (menuItem, event) {
        this.updateBrightnessValue(DEFAULT_VALUE.toString());
        this.updateSlider(descaleNumber(DEFAULT_VALUE));
        this.updateTextEntry(DEFAULT_VALUE);
    },


    updateBrightnessValue: function (value) {
        this.currentValue = value;
        this.statusLabel.set_text(this._labelText());

        if (this.timeoutId == 0) {
            this.timeoutId = Mainloop.timeout_add(TIME_OUT, Lang.bind(this, this.onTimeout));
        }
    },

    onTimeout: function () {
        this.timeoutId = 0;
        this.setBrightnessToAllLCD(this.currentValue);
        Mainloop.source_remove(this.timeoutId);
    },


    updateTextEntry: function (value) {
        this.textEntry.set_text(value.toString());
    },

    updateSlider: function (value) {
        this.slider.setValue(value);
    },

    setBrightnessToAllLCD: function (value) {
        for (var i = 0; i < this.devices.length; i++) {
            this.setLCDBrightness(i, value);
        }
    },

    setLCDBrightness: function (deviceIndex, value) {
        var device = this.devices[deviceIndex];
        //Util.spawn(['sudo', 'ddccontrol', device, '-r', '0x10', '-w', value]);
        this.executeCommand("sudo ddccontrol " + device + " -r 0x10 -w " + value + " 2> /dev/null");
    },

    queryDevices: function () {
        var devices = this.executeCommand('sudo ddccontrol -p  2> /dev/null | grep -i device:');

        devices = devices.replace(/\r?\n|\r| */g, '').replace(/-Device:/g, ',').split(",");
        devices.shift();

        return devices;
    },

    executeCommand: function (command) {
        let output = GLib.spawn_sync(null, ['bash', '-c', command], null, GLib.SpawnFlags.SEARCH_PATH, null);
        return output[0] ? output[1].toString() : "script error";
    }
});

const ExtensionNotificationSource = new Lang.Class({
    Name: 'ExtensionNotificationSource',
    Extends: MessageTray.Source,

    _init: function () {
        this.parent(_("Extension"), 'dialog-warning-symbolic');
    },

    open: function () {
        this.destroy();
    }
});

function notifyError(msg, details) {
    log('error: ' + msg + ': ' + details);
    notify(msg, details);
}

function notify(msg, details) {
    let source = new ExtensionNotificationSource();
    Main.messageTray.add(source);
    let notification = new MessageTray.Notification(source, msg, details);
    if (source.setTransient === undefined)
        notification.setTransient(true);
    else
        source.setTransient(true);
    source.notify(notification);
}
