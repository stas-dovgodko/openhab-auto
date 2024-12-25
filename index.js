const {rules, items, triggers} = require('openhab');


class AutoManager 
{
    pooled = false;

    #onSwitch = false;
    #onChange = false;

    constructor(name, config, managable)
    {
        this.name = name;
        this.manualValue = 'OFF';

        this.onChange = this.onChange.bind(this);
        this.onSwitch = this.onSwitch.bind(this);
        this.auto = this.auto.bind(this);

        this.managerGroup = items.getItem('gAutoManager', true);
        if (this.managerGroup === null) {
            items.addItem({
                type: 'Group',
                name: 'gAutoManager',
            });
            this.managerGroup = items.getItem('gAutoManager');
        }

        if (('groups' in config) && Array.isArray(config.groups)) {
            config.groups.push('gAutoManager');
        } else {
            config.groups = ['gAutoManager'];            
        }

        this.itemConfig = Object.assign(config, {
            type: 'String',
            name: items.safeItemName(`AutoManager_${this.name}State`),
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
            triggers: [triggers.ItemStateChangeTrigger(this.itemConfig.name, undefined, undefined, 'switch')],
            execute: (event) => {
                let t = time.ZonedDateTime.now().toString();

                items.metadata.replaceMetadata(event.itemName, 'updated', `${t}`);
                items.metadata.replaceMetadata(event.itemName, 'automation', '');

                try {
                    const auto_state = (items.getItem(this.itemConfig.name).state == 'ON');
                    rules.setEnabled(items.safeItemName(`${this.name}_handle`), auto_state);

                    if (this.#onSwitch) {
                        this.#onSwitch.call(this, event);
                    }
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
                let item = items.getItem(this.itemConfig.name);
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
                        if (!item.persistence.changedSince(t)) {
                            item.postUpdate('ON');
                        }
                        items.metadata.replaceMetadata(item, 'automation', `${elapsed}`);
                    } else {
                        items.metadata.replaceMetadata(item, 'automation', '');
                    }
            },
            tags: ['AutoManager'],
            id: `automation_intervals_${this.name}`,
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
                            triggers.ItemStateChangeTrigger(name, undefined, undefined, 'manual')
                        ],
                        execute: (event) => {
                            const meta_name = items.safeItemName(`${this.name}_auto`);
                            const meta = items.getItem(event.itemName).getMetadata(meta_name)
                            if (items.getItem(this.itemConfig.name).state == 'ON' && (!meta)) {
                                items.getItem(this.itemConfig.name).postUpdate(this.manualValue);

                                if (this.#onSwitch) {
                                    this.#onSwitch.call(this, event);
                                }
                            } else { 
                                items.getItem(name).removeMetadata(meta_name);
                                if (this.#onChange) {
                                    this.#onChange.call(this, event);
                                }
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
    

    auto(name, command) {
        const meta_name = items.safeItemName(`${this.name}_auto`);
        if (this.items.includes(name)) {
            items.getItem(name).replaceMetadata(meta_name, command);

            //let before = items.getItem(name).state;
            if (items.getItem(name).sendCommandIfDifferent(command)) {
            }
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
                items.metadata.replaceMetadata(this.itemConfig.name, 'stateDescription', "", {
                    'options': options.substring(0, options.length-1)
                });
                items.metadata.replaceMetadata(this.itemConfig.name, 'commandDescription', "", {
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

    onChange(callback)
    {
        this.#onChange = callback;

        return this;
    }

    onSwitch(callback)
    {
        this.#onSwitch = callback;

        return this;
    }

    hint(text) {
        if (text === undefined) {
            let meta = items.getItem(this.itemConfig.name).getMetadata('hint');
            if (meta !== null) {
                return meta.value;
            } else {
                return null;
            }
        } else {
            items.getItem(this.itemConfig.name).replaceMetadata('hint', text);

            return this;
        }
    }

    handle(callback, extratriggers, debounce = 15) {
        const rule_id = items.safeItemName(`${this.name}_handle`);
        let t = [
            triggers.ItemStateUpdateTrigger(this.itemConfig.name)
        ];
        if (Array.isArray(extratriggers)) {

            extratriggers.forEach((trigger) => {
                if (typeof trigger === 'string' || trigger instanceof String) {
                    t.push(triggers.ItemStateUpdateTrigger(trigger));
                } else {
                    t.push(trigger);
                }
            });
        }
        if (debounce > 0 && debounce <= 60) {

            t.push(triggers.GenericCronTrigger('0/' + debounce + ' * * ? * * *', 'debouce'));
        } else if (debounce > 60 && debounce <= 3600) {

            t.push(triggers.GenericCronTrigger('0 0/' + Math.round(debounce / 60) + ' * ? * * *', 'debouce'));
        }

        this.pooled = false;
        rules.JSRule({
            name: 'Automanager handle rule',
            triggers: t,
            execute: event => {
                if (debounce && (event.module != 'debouce')) { // debounce
                    this.pooled = event; // should be debounced
                    return;
                }
                if (debounce && this.pooled == false) {
                    return;
                }

                if (items.getItem(this.itemConfig.name).state !== 'ON') return;

                let callback_return = callback.call(this, (this.pooled != false) ? this.pooled : event);

                if (this.simpleMode !== null && (typeof callback_return === 'string' || callback_return instanceof String)) {
                    this.auto(this.simpleMode, callback_return);
                }
                this.pooled = false;
            },
            tags: ['AutoManager'],
            id: rule_id,
            overwrite: true
        });

        rules.setEnabled(rule_id, items.getItem(this.itemConfig.name).state == 'ON');

        return this;
    }
}



exports.manager = (name, config, managable) => {


    return new Proxy(new AutoManager(name, config, managable), {
        
        set(target, name, value, receiver) {
            if (Reflect.has(target, name)) {
                return Reflect.set(target, name, value, receiver);
                
            }
            
            target.auto(name, value);
        },

        get(target, name, receiver) {

            if (Reflect.has(target, name)) {
                return Reflect.get(target, name, receiver);
                
            }

            return items.getItem(prop).state;
        }
    });
}
