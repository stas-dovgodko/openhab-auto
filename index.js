const {rules, items, triggers} = require('openhab');

class AutoManager 
{
    constructor(name, config, managable)
    {
        this.name = name;
        this.manualValue = 'OFF';

        this.managerGroup = items.getItem('gAutoManager', true);
        if (this.managerGroup === null) {
            items.addItem({
                type: 'Group',
                name: 'gAutoManager',
            });
            this.managerGroup = items.getItem('gAutoManager');
        }


        this.itemConfig = Object.assign(config, {
            type: 'String',
            name: this.stateItemName(),
            groups: ['gAutoManager'],
            metadata: {
                automation: {
                    value: null,
                    config: {

                    }
                },
                updated: {
                    value: null,
                    config: {
                        
                    }
                },
                stateDescription: {
                    config: {
                        pattern: '%d%%'
                    }
                },
                commandDescription: {
                    config: {
                        pattern: '%d%%'
                    }
                }
            }
        });

        items.replaceItem(this.itemConfig);
        
        this.options({
            'ON': actions.Transformation.transform('MAP', 'automation.map', 'ON'),
            'OFF': actions.Transformation.transform('MAP', 'automation.map', 'OFF'),
            '60': actions.Transformation.transform('MAP', 'automation.map', '1HOFF'),
            '720': actions.Transformation.transform('MAP', 'automation.map', '12HOFF'),
            '1440': actions.Transformation.transform('MAP', 'automation.map', '24OFF')
        }, '720');

        rules.JSRule({
            name: "Track automation time",
            description: "Set meta auto timer",
            triggers: [triggers.ItemStateChangeTrigger(this.stateItemName())],
            execute: (event) => {
                let t = time.ZonedDateTime.now().toString();

                items.metadata.replaceMetadata(event.itemName, 'updated', `${t}`);
                items.metadata.replaceMetadata(event.itemName, 'automation', '');

                try {
                    rules.setEnabled(items.safeItemName(`${this.name}_handle`), items.getItem(this.stateItemName()).state == 'ON');
                } catch (e) {
                    // handle rule is optional
                }
            },
            tags: ['AutoManager'],
            id: `automation_times_${this.name}`,
            overwrite: true
        });
        
        rules.JSRule({
            name: "Track automation iterval",
            description: "Set back auto timer",
            triggers: [triggers.GenericCronTrigger("0 0/1 * * * ?")],
            execute: (event) => {
                items.getItem('gAutoManager').members.forEach(function(item) {
                    let minutes = parseInt(item.state);
        
                    if (minutes > 0) {
                        let t = time.ZonedDateTime.now().minusMinutes(minutes);
                        let elapsed = '';
                        
                        try {
                            let updated = time.toZDT(item.getMetadata('updated').value);
                            elapsed = updated.format(time.DateTimeFormatter.ofPattern('H:m'));
                        } catch (e) {
                            elapsed = '-';
                        }
                        if (!item.history.changedSince(t)) {
                            item.postUpdate('ON');
                        }
                        items.metadata.replaceMetadata(item, 'automation', `${elapsed}`);
                    } else {
                        items.metadata.replaceMetadata(item, 'automation', '');
                    }
                });
            },
            tags: ['AutoManager'],
            id: `automanager_intervals`,
            overwrite: true
        });

        this.items = []; this.simpleMode = null;
        if (typeof managable === 'string' || managable instanceof String) {
            this.simpleMode = managable;
            managable = [managable];
        }
        if (Array.isArray(managable)) {
            managable.forEach((name) => {
                let managable_item = items.getItem(name, true);
                if (managable_item != null) {
                    this.items.push(name);
                    rules.JSRule({
                        name: 'Automanager manual rule',
                        triggers: [
                            triggers.ItemStateChangeTrigger(name)
                        ],
                        execute: (event) => {
                            const meta = items.getItem(event.itemName).getMetadata(items.safeItemName(`${this.name}_auto`))
                            if (items.getItem(this.stateItemName()).state == 'ON' && (!meta || items.getItem(event.itemName).state != meta.value)) {
                                items.getItem(this.stateItemName()).postUpdate(this.manualValue);
                            }
                        },

                        tags: ['AutoManager'],
                        id: `automanager_manual_${this.name}_${name}`,
                        overwrite: true
                    });
                }
            });
        }
    }


    sendAutoCommand(name, command) {
        const meta_name = items.safeItemName(`${this.name}_auto`);
        if (this.items.includes(name)) {
            items.getItem(name).replaceMetadata(meta_name, command);
            items.getItem(name).sendCommand(command);
        }
    }

    manual(manual) {
        this.manualValue = manual.toString();
    }

    options(map, manual) {
        let options = "";

        for (const [key, value] of Object.entries(map)) {
            options = options.concat(key, "=", value, ",");
        };

        if (options.length > 0) {
            try {
                items.metadata.replaceMetadata(this.stateItemName(), 'stateDescription', "", {
                    'options': options.substring(0, options.length-1)
                });
                items.metadata.replaceMetadata(this.stateItemName(), 'commandDescription', "", {
                    'options': options.substring(0, options.length-1)
                });
            } catch (e) {
                // meta a little buggy
            }
        }

        if (manual) {
            
            this.manual(manual);
        }
    }

    state() {
        return items.getItem(this.stateItemName()).state;
    }

    stateItemName() {
        return items.safeItemName(`AutoManager_${this.name}State`);
    }

    description(newdescription) {
        if (newdescription === undefined) {
            let meta = items.getItem(this.stateItemName()).getMetadata('description');
            if (meta !== null) {
                return meta.value;
            } else {
                return null;
            }
        } else {
            items.getItem(this.stateItemName()).replaceMetadata('description', newdescription);

            return this;
        }
    }



    triggers(extra) {

        let list = [triggers.ItemStateUpdateTrigger(this.stateItemName())];

        if (Array.isArray(extra)) {
            return list.concat(extra);
        } else {
            return list;
        }
    }

    handle(callback, extratriggers) {
        const rule_id = items.safeItemName(`${this.name}_handle`);
        let t = [
            triggers.ItemStateUpdateTrigger(this.stateItemName())
        ];
        if (Array.isArray(extratriggers)) {
            t = t.concat(extratriggers);
        }
        rules.JSRule({
            name: 'Automanager handle rule',
            triggers: t,
            execute: event => {
                let callback_return = callback.call(this, event);

                if (this.simpleMode !== null && (typeof callback_return === 'string' || callback_return instanceof String)) {
                    this.sendAutoCommand(this.simpleMode, callback_return);
                }
            },
            tags: ['AutoManager'],
            id: rule_id,
            overwrite: true
        });

        rules.setEnabled(rule_id, items.getItem(this.stateItemName()).state == 'ON');
    }
}



exports.manager = (name, config, managable) => {

    return new AutoManager(name, config, managable);
}
