const monsterAssist = (() => {
  const die = sides => Math.floor(Math.random() * sides) + 1;
  function dice(text) {
    const match = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(text || "");
    if (!match) return null;
    const [,count,sides,sign,modifier] = match;
    const term = {count:Number(count), sides:Number(sides), modifier:(sign === "-" ? -1 : 1) * Number(modifier || 0)};
    return term.count >= 1 && term.count <= 100 && term.sides >= 2 && term.sides <= 1000
      && Math.abs(term.modifier) <= 10000 ? term : null;
  }

  function damageTerms(components = []) {
    if (!components.length || components.length > 16) return null;
    const terms = components.map(component => dice(component.dice));
    return terms.every(Boolean) ? terms : null;
  }

  function rollDamage(terms, canCrit) {
    let normal = 0, critical = 0;
    for (const {count,sides,modifier} of terms) {
      let first = modifier, extra = 0;
      for (let i = 0; i < count; i++) first += die(sides);
      if (canCrit) for (let i = 0; i < count; i++) extra += die(sides);
      normal += Math.max(0, first);
      critical += Math.max(0, first + extra);
    }
    return {normal,critical};
  }

  function armor(state, target) {
    const row = state?.combat.rows.find(row => row.id === target);
    if (row?.enemy) {
      if (row.enemy.template?.monster.stats.defenses.conditional_ac?.length) return null;
      return Number.isInteger(row.enemy.ac) ? row.enemy.ac : null;
    }
    const member = state?.members?.find(member => member.member_id === (row?.damage_recipient || target));
    const value = member?.inspection?.vitals?.effective_ac;
    return member?.online && Number.isInteger(value) ? value : null;
  }

  function compare(natural, total, ac) {
    if (!Number.isInteger(ac)) return null;
    if (natural === 1) return "miss";
    if (natural === 20) return "hit";
    return Number.isInteger(total) ? (total >= ac ? "hit" : "miss") : null;
  }

  function branch(save, outcome) {
    if (!save) return outcome === "hit" ? "full" : null;
    if (outcome === "save_success") return save.on_success;
    if (outcome === "save_failure") return save.on_failure;
    return null;
  }

  function amount(raw, branch) {
    if (branch === "none") return 0;
    if (!Number.isInteger(raw)) return null;
    if (branch === "half") return Math.floor(raw / 2);
    return branch === "full" ? raw : null;
  }

  return {die, damageTerms, rollDamage, armor, compare, branch, amount};
})();
