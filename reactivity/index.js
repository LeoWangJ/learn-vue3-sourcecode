const bucket = new WeakMap()

let activeEffect
const effectStack = []

function effect (fn,options = {}){
  const effectFn = () =>{
    cleanup(effectFn)
    activeEffect = effectFn
    effectStack.push(effectFn)
    fn()
    effectStack.pop(effectFn)
    activeEffect = effectStack[effectStack.length - 1]
  }
  effectFn.options = options
  effectFn.deps = []
  effectFn()
}

// 刪除與之關聯的集合
function cleanup(effectFn) {
  for(let i = 0;i < effectFn.deps.length;i++){
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  effectFn.deps.length = 0
}

const data = { ok :true, text: 'hello world', bar:'bar', foo: 'foo'}

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
  // 與當前副作用函式存在聯繫的依賴集合
  activeEffect.deps.push(deps)
}

// 函數觸發變化
function trigger(target,key){
  const depsMap = bucket.get(target)
  if(!depsMap) return
  const effects = depsMap.get(key)
  // 創建一個新的Set，可參考 Set.prototype.forEach 會造成什麼問題
  effects && effects.forEach(effectFn =>{
    // 如果 trigger 觸發執行的副作用函式與當前正在執行的副作用函式相同，則不進行觸發
    if(effectFn !== activeEffect){
      effectsToRun.add(effectFn)
    }
  })
  const effectsToRun = new Set(effects)
  effectsToRun.forEach(effectFn => {
    // 如果存在調度器，則調用調度器，並將副作用函式作為參數傳遞
    if(effectFn.options.scheduler){
      effectFn.options.scheduler(effectFn)
    }else{
      effectFn()
    }
  })
}

// test 1
// effect(function effectFn () {
//   document.body.innerText = obj.ok ? obj.text : 'not'
// })
// setTimeout(()=>{
//   obj.ok = false
// },3000)
// setTimeout(() =>{
//   obj.text = 'hello vu3'
// },5000)

// test effect stack

effect(() =>{
  console.log('effect1')

  effect(()=>{
    console.log('effect2')
    obj.foo
  })
  obj.bar 
})

obj.bar = 'test'