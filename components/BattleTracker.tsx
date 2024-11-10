// BattleTracker.jsx

'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Clock, Heart, Scroll, Shield, Swords, Star, Focus } from 'lucide-react';
import bestiaryIndex from '../data/bestiary/index.json';
import spellsIndex from '../data/spells/index.json';
import { FixedSizeList as List } from 'react-window';
import { Label } from '@radix-ui/react-select';
import { Textarea } from '@/components/ui/textarea';
import { v4 as uuidv4 } from 'uuid';
import { Reorder, AnimatePresence, motion } from 'framer-motion'; // Import Framer Motion components

// Debounce Hook
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay || 300);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
};

// Utility to load and combine monster and spell data
const useGameData = () => {
  const [monsters, setMonsters] = useState([]);
  const [spells, setSpells] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load all monster files dynamically using the index.json mappings
        const monsterFiles = await Promise.all(
          Object.values(bestiaryIndex).map(async (file) => {
            const module = await import(`/data/bestiary/${file}`);
            return module.default.monster || [];
          })
        );

        // Load all spell files dynamically using the index.json mappings
        const spellFiles = await Promise.all(
          Object.values(spellsIndex).map(async (file) => {
            const module = await import(`/data/spells/${file}`);
            return module.default.spell || [];
          })
        );

        // Process monster data
        const allMonsters = monsterFiles
          .flat()
          .filter(Boolean)
          .map((monster, index) => ({
            id: `${monster.name}-${monster.source}-${index}`
              .toLowerCase()
              .replace(/\s+/g, '-'),
            name: monster.name || 'Unknown Monster',
            hp: {
              current: monster.hp?.average || 0,
              max: monster.hp?.average || 0,
            },
            ac: Array.isArray(monster.ac)
              ? monster.ac[0]?.ac || monster.ac[0] || 10
              : monster.ac || 10,
            stats: {
              str: monster.str || 10,
              dex: monster.dex || 10,
              con: monster.con || 10,
              int: monster.int || 10,
              wis: monster.wis || 10,
              cha: monster.cha || 10,
            },
            attacks: monster.action
              ?.filter((a) => a?.entries?.[0]?.match(/\{@atk /)) // Filter for attack actions
              ?.map((a) => ({
                name: a.name,
                description: a.entries[0],
                damage: a.entries[0].match(/\{@damage ([^}]+)\}/)?.[1] || '1d4',
                type: a.entries[0].match(/(\w+) damage/)?.[1] || 'slashing',
                bonus: parseInt(a.entries[0].match(/\{@hit (\d+)\}/)?.[1]) || 0,
              })) || [],
            nonAttacks: monster.action
              ?.filter((a) => !a?.entries?.[0]?.match(/\{@atk /)) // Filter for non-attack actions
              ?.map((a) => ({
                name: a.name,
                description: a.entries.join(" "),
              })) || [],
            spells: processSpellcasting(monster.spellcasting?.[0]),
            effects: [],
            type: monster.type,
            cr: monster.cr,
            source: monster.source,
            favorite: false,
            initiative: null,
          }));

        // Process spell data
        const allSpells = spellFiles
          .flat()
          .filter(Boolean)
          .map((spell) => ({
            id: `${spell.name}-${spell.source}`
              .toLowerCase()
              .replace(/\s+/g, '-'),
            name: spell.name,
            level: spell.level,
            school: spell.school,
            time: spell.time,
            range: spell.range,
            components: spell.components,
            duration: Array.isArray(spell.duration)
              ? spell.duration[0]?.type || 'instant'
              : 'instant',
            description: Array.isArray(spell.entries)
              ? spell.entries.join('\n')
              : spell.entries || 'No description available',
            damageInflict: spell.damageInflict || [],
            savingThrow: spell.savingThrow || [],
            source: spell.source,
            dc: 15, // Default DC, should be calculated based on caster
          }));

        setMonsters([...new Map(allMonsters.map((m) => [m.id, m])).values()]);
        setSpells([...new Map(allSpells.map((s) => [s.id, s])).values()]);
        setLoading(false);
      } catch (err) {
        console.error('Error loading data:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    loadData();
  }, []);

  return { monsters, spells, loading, error };
};

// Helper function to process spellcasting data
const processSpellcasting = (spellcasting) => {
  if (!spellcasting) return [];

  const spellList = [];
  const spells = spellcasting.spells || {};

  Object.entries(spells).forEach(([level, data]) => {
    const spellLevel = parseInt(level) || 0;
    const spellNames = data.spells || [];

    spellNames.forEach((spellName) => {
      // Clean up spell name from {@spell name} format
      const cleanName = spellName.replace(/\{@spell ([^}]+)\}/, '$1');
      spellList.push({
        name: cleanName,
        level: spellLevel,
        dc: spellcasting.spelldc || 15,
        description: `Level ${spellLevel} spell`,
      });
    });
  });

  return spellList;
};

const BattleTracker = () => {
  const { monsters, loading, error } = useGameData();
  const [characters, setCharacters] = useState([]);
  const [actingCharacter, setActingCharacter] = useState(null);
  const [selectedTargets, setSelectedTargets] = useState([]);
  const [hpDialogOpen, setHpDialogOpen] = useState(false);
  const [hpChange, setHpChange] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [filteredCharacters, setFilteredCharacters] = useState([]);
  const [showTooManyResults, setShowTooManyResults] = useState(false);
  const [initiativeRolled, setInitiativeRolled] = useState(false);
  const [statDialogOpen, setStatDialogOpen] = useState(false);
  const [selectedStat, setSelectedStat] = useState('');
  const [attackListDialogOpen, setAttackListDialogOpen] = useState(false);
  const [actionListDialogOpen, setActionListDialogOpen] = useState(false);
  const [spellListDialogOpen, setSpellListDialogOpen] = useState(false);
  const [effectDialogOpen, setEffectDialogOpen] = useState(false);
  const [newEffect, setNewEffect] = useState({ name: '', description: '', rounds: 10 });
  const [concentrationTargets, setConcentrationTargets] = useState(new Set());


  const rotationIncrement = -15; // degrees per index
  const blurIncrement = 1; // pixels per index

  useEffect(() => {
    if (monsters.length > 0) {
      setCharacters(monsters.slice(0, 6).map(char => ({ ...char, instanceId: uuidv4() }))); // Assign unique IDs
    }
  }, [monsters]);

  // Search for characters to add to the battle
  useEffect(() => {
    if (debouncedSearchTerm) {
      const results = monsters.filter((char) =>
        char.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      );

      if (results.length <= 20) {
        setFilteredCharacters(results);
        setShowTooManyResults(false);
      } else {
        setFilteredCharacters([]);
        setShowTooManyResults(true);
      }
    } else {
      setFilteredCharacters([]);
      setShowTooManyResults(false);
    }
  }, [debouncedSearchTerm, monsters]);

  // Utility functions
  const rollDice = (dice) => {
    if (!dice) return 0;
    const [count, sides] = dice.split('d').map(Number);
    if (!count || !sides) return 0;
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += Math.floor(Math.random() * sides) + 1;
    }
    return total;
  };

  const addEffect = (effect, target) => {
    if (!effect || !target) return;
    setCharacters((prev) =>
      prev.map((char) => {
        if (char.instanceId === target.instanceId) {
          return {
            ...char,
            effects: [
              ...(char.effects || []),
              {
                name: effect.name,
                description: effect.description,
                rounds: 10,
                source: actingCharacter?.name || 'Unknown',
              },
            ],
          };
        }
        return char;
      })
    );
  };

  const decrementEffects = () => {
    setCharacters((prev) =>
      prev.map((char) => {
        if (char.instanceId === actingCharacter.instanceId) {
          return {
            ...char,
            effects: (char.effects || [])
              .map((effect) => ({
                ...effect,
                rounds: effect.rounds - 1,
              }))
              .filter((effect) => effect.rounds > 0),
          };
        }
        return char;
      })
    );
  };

  const modifyHp = (amount, target) => {
    if (!amount || !target) return;

    // Check concentration if damage is dealt
    if (amount < 0 && concentrationTargets.has(target.instanceId)) {
      const conMod = Math.floor((target.stats.con - 10) / 2);
      const saveDC = Math.max(10, Math.floor(Math.abs(amount) / 2));
      const roll = rollDice('1d20');
      const total = roll + conMod;

      if (total < saveDC) {
        setConcentrationTargets(prev => {
          const next = new Set(prev);
          next.delete(target.instanceId);
          return next;
        });
        alert(`${target.name} failed concentration check (DC ${saveDC}): ${total} < ${saveDC}`);
      } else {
        alert(`${target.name} maintained concentration (DC ${saveDC}): ${total} >= ${saveDC}`);
      }
    }

    setCharacters((prev) =>
      prev.map((char) => {
        if (char.instanceId === target.instanceId) {
          const newHp = Math.max(0, Math.min(char.hp.max, char.hp.current + amount));
          return {
            ...char,
            hp: { ...char.hp, current: newHp },
          };
        }
        return char;
      })
    );
    setHpDialogOpen(false);
    setHpChange('');
  };

  const toggleConcentration = (charId) => {
    setConcentrationTargets(prev => {
      const next = new Set(prev);
      if (next.has(charId)) {
        next.delete(charId);
      } else {
        next.add(charId);
      }
      return next;
    });
  };

  const addCustomEffect = (target) => {
    if (!newEffect.name || !target) return;
    setCharacters((prev) =>
      prev.map((char) => {
        if (char.instanceId === target.instanceId) {
          return {
            ...char,
            effects: [
              ...(char.effects || []),
              {
                ...newEffect,
                source: actingCharacter?.name || 'Unknown',
              },
            ],
          };
        }
        return char;
      })
    );
    setEffectDialogOpen(false);
    setNewEffect({ name: '', description: '', rounds: 10 });
  };

  const rollSavingThrow = (char, stat) => {
    if (!char || !stat) return;
    const mod = Math.floor((char.stats[stat] - 10) / 2);
    const roll = rollDice('1d20');
    alert(
      `${char.name}'s ${stat.toUpperCase()} save:\nRoll: ${roll}\nModifier: ${mod}\nTotal: ${roll + mod
      }`
    );
    setStatDialogOpen(false);
  };

  // Add character to the battle
  const addCharacterToBattle = (char) => {
    const newChar = { ...char, instanceId: uuidv4() }; // Assign unique ID
    setCharacters((prev) => [...prev, newChar]);
    setSearchTerm('');
    setFilteredCharacters([]);
  };

  // Toggle favorite
  const toggleFavorite = (char) => {
    setCharacters((prev) =>
      prev.map((c) => {
        if (c.instanceId === char.instanceId) {
          return { ...c, favorite: !c.favorite };
        }
        return c;
      })
    );
  };

  // Roll initiative
  const rollInitiative = () => {
    setCharacters((prevCharacters) => {
      console.log(prevCharacters)
      const charactersWithInitiative = prevCharacters.map((char) => {
        if (char.favorite) {
          const manualInit = prompt(`Enter initiative for ${char.name}:`, '10');
          return { ...char, initiative: parseInt(manualInit) || 0 };
        } else {
          const dexMod = Math.floor((char.stats.dex - 10) / 2);
          const initRoll = rollDice('1d20') + dexMod;
          return { ...char, initiative: initRoll };
        }
      });
      // Sort the characters in initiative order
      return charactersWithInitiative.sort((a, b) => b.initiative - a.initiative);
    });
    setInitiativeRolled(true);
  };

  // Update actingCharacter when characters change
  useEffect(() => {
    if (initiativeRolled && characters.length > 0) {
      setActingCharacter(characters[0]);
    }
  }, [characters, initiativeRolled]);


  // End turn functionality
  const endTurn = () => {
    setCharacters((prevCharacters) => {
      const newOrder = [...prevCharacters];
      const firstChar = newOrder.shift();
      newOrder.push(firstChar);
      return newOrder;
    });
    decrementEffects();
  };


  if (loading) {
    // Loading UI
  }

  if (error) {
    // Error UI
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      {/* Search and Add Characters */}
      {/* ... */}

      {/* Initiative Roll Button */}
      {!initiativeRolled && (
        <Button variant="outline" onClick={rollInitiative} className="mb-4">
          Roll Initiative
        </Button>
      )}

      {/* Battle Grid */}
      <div className="flex">
        {/* Main Characters Column */}
        <div
          className="flex flex-col flex-1 gap-10"
          style={{
            perspective: '1000px',
          }}
        >
          <AnimatePresence>
            {characters.map((char, index) => (
              <motion.div
                key={char.instanceId}
                layout
                animate={{
                  rotateX: index * rotationIncrement,
                  filter: `blur(${index * blurIncrement}px)`,
                }}
                transition={{
                  duration: 0.5,
                }}
                style={{
                  transformStyle: 'preserve-3d',
                  zIndex: characters.length - index,
                }}
              >
                <Card
                  className={`border ${actingCharacter?.instanceId === char.instanceId ? 'border-blue-500' : ''
                    } ${char.favorite ? 'bg-yellow-100' : ''}`}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{char.name}</span>
                      <div className="flex gap-2">
                        {/* Armor Class */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge variant="outline" className="flex gap-2">
                                <Shield className="h-4 w-4" />
                                {char.ac}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>Armor Class</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* HP */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Button
                                variant="ghost"
                                className="flex gap-2 p-0"
                                onClick={() => {
                                  setHpDialogOpen(true);
                                  setSelectedTargets([char]);
                                }}
                              >
                                <Heart className="h-4 w-4" />
                                {char.hp.current}/{char.hp.max}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Click to modify HP</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Concentration */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Button
                                variant="ghost"
                                className="p-0 w-10"
                                onClick={() => toggleConcentration(char.instanceId)}
                              >
                                <Focus
                                  className={`h-4 w-4 ${concentrationTargets.has(char.instanceId) ? 'text-purple-500' : ''
                                    }`}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Concentration</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Favorite */}
                        <Button
                          variant="ghost"
                          className="p-0 w-10"
                          onClick={() => toggleFavorite(char)}
                        >
                          <Star
                            className={`h-4 w-4 ${char.favorite ? 'text-yellow-500' : ''}`}
                          />
                        </Button>
                      </div>
                    </CardTitle>
                  </CardHeader>

                  <CardContent>
                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTargets([char]);
                          setStatDialogOpen(true);
                        }}
                      >
                        Roll Saving Throw
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTargets([char]);
                          setAttackListDialogOpen(true);
                        }}
                      >
                        View Attacks
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTargets([char]);
                          setActionListDialogOpen(true);
                        }}
                      >
                        View Actions
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTargets([char]);
                          setSpellListDialogOpen(true);
                        }}
                      >
                        View Spells
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedTargets([char]);
                          setEffectDialogOpen(true);
                        }}
                      >
                        Add Effect
                      </Button>
                    </div>

                    {/* Effects */}
                    <div className="mb-4">
                      <h3 className="text-sm font-medium mb-2">Active Effects</h3>
                      <div className="flex flex-wrap gap-2">
                        {char.effects?.map((effect, i) => (
                          <TooltipProvider key={i}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="flex gap-2 items-center">
                                  {effect.name}
                                  <span className="text-xs">({effect.rounds})</span>
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-bold">{effect.name}</p>
                                <p className="text-sm">{effect.description}</p>
                                <p className="text-sm mt-1">Source: {effect.source}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ))}
                      </div>
                    </div>

                    {/* End Turn Button */}
                    {actingCharacter?.instanceId === char.instanceId && (
                      <div className="mt-4 flex justify-between">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={endTurn}
                          className="flex gap-2"
                        >
                          End Turn
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Actions and Spells for Acting Character */}
      {actingCharacter && (
        <div className="mt-4">
          <h2 className="text-lg font-bold mb-2">Actions for {actingCharacter.name}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Actions Section */}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full flex gap-2">
                  <Swords className="h-4 w-4" /> Actions
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Actions</DialogTitle>
                  <DialogDescription>Select action to perform</DialogDescription>
                </DialogHeader>

                <ScrollArea className="h-[300px]">
                  {actingCharacter?.attacks?.map((attack, i) => (
                    <Button
                      key={i}
                      variant="ghost"
                      className="w-full justify-between mb-2"
                      disabled={selectedTargets.length === 0}
                      onClick={() => {
                        const damage = rollDice(attack.damage);
                        selectedTargets.forEach((target) => {
                          modifyHp(-damage, target);
                        });
                      }}
                    >
                      {attack.name}
                      <Badge variant="secondary">+{attack.bonus} to hit</Badge>
                    </Button>
                  ))}
                </ScrollArea>
              </DialogContent>
            </Dialog>

            {/* Spells Section */}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full flex gap-2">
                  <Scroll className="h-4 w-4" /> Spells
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Spells</DialogTitle>
                  <DialogDescription>Select spell to cast</DialogDescription>
                </DialogHeader>

                <ScrollArea className="h-[300px]">
                  {actingCharacter?.spells?.map((spell, i) => (
                    <TooltipProvider key={i}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            className="w-full justify-between mb-2"
                            disabled={selectedTargets.length === 0}
                            onClick={() => {
                              selectedTargets.forEach((target) => {
                                // For demonstration, we'll assume spells inflict 1d6 damage
                                const damage = rollDice('1d6');
                                modifyHp(-damage, target);
                                // Add effect if applicable
                                if (spell.description.includes('effect')) {
                                  addEffect(
                                    {
                                      name: spell.name,
                                      description: spell.description,
                                    },
                                    target
                                  );
                                }
                              });
                            }}
                          >
                            {spell.name}
                            <Badge variant="secondary">Level {spell.level}</Badge>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="w-[300px]">
                          <p className="font-bold">{spell.name}</p>
                          <p className="text-sm">{spell.description}</p>
                          <p className="text-sm mt-2">
                            Save DC: {spell.dc}{' '}
                            {spell.savingThrow && `(${spell.savingThrow.join(', ')})`}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      )}

      {/* Next Round and End Turn Buttons */}

      {/* Attack List Dialog */}
      <Dialog open={attackListDialogOpen} onOpenChange={setAttackListDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Available Attacks</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[300px]">
            {selectedTargets[0]?.attacks?.map((attack, i) => (
              <div key={i} className="p-2 border-b">
                <div className="font-medium">{attack.name}</div>
                <div className="text-sm text-muted-foreground">
                  To Hit: +{attack.bonus} | Damage: {attack.damage}
                </div>
              </div>
            ))}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Attack List Dialog */}
      <Dialog open={actionListDialogOpen} onOpenChange={setActionListDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Available Actions</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[300px]">
            {selectedTargets[0]?.nonAttacks?.map((nonAttacks, i) => (
              <div key={i} className="p-2 border-b">
                <div className="font-medium">{nonAttacks?.name}</div>
                <div className="text-sm text-muted-foreground">
                  {nonAttacks?.description}
                </div>
              </div>
            ))}
          </ScrollArea>
        </DialogContent>
      </Dialog>


      {/* HP Modification Dialog */}
      <Dialog open={hpDialogOpen} onOpenChange={setHpDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modify HP</DialogTitle>
            <DialogDescription>
              Enter amount to heal (+) or damage (-) for{' '}
              {selectedTargets.map((t) => t.name).join(', ')}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="number"
            value={hpChange}
            onChange={(e) => setHpChange(e.target.value)}
            placeholder="Enter HP change"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setHpDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const amount = parseInt(hpChange);
                selectedTargets.forEach((target) => modifyHp(amount, target));
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stat Selection Dialog */}
      <Dialog open={statDialogOpen} onOpenChange={setStatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Stat</DialogTitle>
            <DialogDescription>
              Select stat to roll saving throw for{' '}
              {selectedTargets.map((t) => t.name).join(', ')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {['str', 'dex', 'con', 'int', 'wis', 'cha'].map((stat) => (
              <Button
                key={stat}
                variant="outline"
                onClick={() => {
                  selectedTargets.forEach((char) => rollSavingThrow(char, stat));
                }}
              >
                {stat.toUpperCase()}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={spellListDialogOpen} onOpenChange={setSpellListDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Available Spells</DialogTitle>
            <DialogDescription>
              View spells for {selectedTargets[0]?.name}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[300px]">
            {selectedTargets[0]?.spells?.map((spell, i) => (
              <div key={i} className="p-2 border-b">
                <div className="font-medium">{spell.name}</div>
                <div className="text-sm text-muted-foreground">
                  Level {spell.level} | Save DC: {spell.dc}
                </div>
                <div className="text-sm mt-1">{spell.description}</div>
              </div>
            ))}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={effectDialogOpen} onOpenChange={setEffectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Effect</DialogTitle>
            <DialogDescription>
              Add effect to {selectedTargets[0]?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Effect Name</Label>
              <Input
                value={newEffect.name}
                onChange={(e) => setNewEffect(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Effect name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={newEffect.description}
                onChange={(e) => setNewEffect(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Effect description"
              />
            </div>
            <div>
              <Label>Duration (rounds)</Label>
              <Input
                type="number"
                value={newEffect.rounds}
                onChange={(e) => setNewEffect(prev => ({ ...prev, rounds: parseInt(e.target.value) }))}
                min="1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEffectDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => addCustomEffect(selectedTargets[0])}>
              Add Effect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BattleTracker;
