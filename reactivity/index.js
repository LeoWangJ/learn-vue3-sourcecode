const bucket = new WeakMap()

let activeEffect
function effect (fn){
  activeEffect = fn
  fn()
}
const data = {text:'hello'}

const obj = new Proxy(data,{
  get(target,key){
    if(!activeEffect) return target[key]

    let dapsMap = bucket.get(target)
    if(!dapsMap) bucket.set(target, (depMap = new Map()))

    let daps = dapsMap.get(key)
    if(!daps) dapsMap.set(key,(deps = new Set()))
    daps.add(activeEffect)

    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    const dapsMap = bucket.get(target)
    if(!dapsMap) return 
    const effects = dapsMap.get(key)
    effects && effects.forEach(fn => fn())
  }
})

// test
effect()
setTimeout(() =>{
  obj.text = 'hello vu3'
},1000)