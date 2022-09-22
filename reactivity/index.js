const bucket = new WeakMap()

let activeEffect
function effect (fn){
  const effectFn = () =>{
    cleanup(effectFn)
    activeEffect = effectFn
    fn()
  }
  effectFn.deps = []
  effectFn()
}

function cleanup(effectFn) {
  for(let i = 0;i < effectFn.deps.length;i++){
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  effectFn.deps.length = 0
}

const data = { ok :true, text: 'hello world'}

const obj = new Proxy(data,{
  get(target,key){
    track(target,key)
    return target[key]
  },
  set(target,key,newVal){
    target[key] = newVal
    trigger(target,key)
  }
})

// 函數追蹤變化
function track(target,key){
  if(!activeEffect) return 
  let depsMap = bucket.get(target)
  if(!depsMap) bucket.set(target, (depsMap = new Map()))
 
  let deps = depsMap.get(key)
  if(!deps) depsMap.set(key,(deps = new Set()))
  deps.add(activeEffect)
  activeEffect.deps.push(deps)
}

// 函數觸發變化
function trigger(target,key){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  // 參考 Set.prototype.forEach 
  const effectsToRun = new Set(effects)
  effectsToRun.forEach(effectFn => effectFn())
}

// test
effect(function effectFn () {
  document.body.innerText = obj.ok ? obj.text : 'not'
})
setTimeout(()=>{
  obj.ok = false
},3000)
setTimeout(() =>{
  obj.text = 'hello vu3'
},5000)